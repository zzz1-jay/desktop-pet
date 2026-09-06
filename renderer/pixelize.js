// 像素化窗口渲染进程：
// 原图 → （可选）容差抠背景 → 拖框裁剪人物 → 透明感知缩进 64×64 → 色彩量化 → 预览 → 保存换装
const sourceEl = document.getElementById('source');
const resultEl = document.getElementById('result');
const removeBgEl = document.getElementById('remove-bg');
const toleranceEl = document.getElementById('tolerance');
const toleranceValueEl = document.getElementById('tolerance-value');
const colorsEl = document.getElementById('colors');
const nameEl = document.getElementById('pet-name');
const statusEl = document.getElementById('status');
const saveEl = document.getElementById('save');

const sourceCtx = sourceEl.getContext('2d');
const resultCtx = resultEl.getContext('2d');

const SPRITE_SIZE = 64;
const WORK_MAX = 480; // 工作分辨率：抠背景 / 裁剪在这一档做，速度和精度平衡

let img = null;
let work = null; // { rgba, w, h } 工作图
let crop = null; // { x, y, w, h } 裁剪框（工作图坐标）
let quantized = null;
let dragging = false;
let dragAnchor = null;

function closeWindow() {
  window.pixelizeAPI.cancel();
}

// ---- 工作图准备 ----

function loadImage(dataUrl) {
  const image = new Image();
  image.onload = () => {
    img = image;
    statusEl.textContent = ''; // 清掉上一次的「已换装」残留
    const scale = Math.min(1, WORK_MAX / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const offCtx = off.getContext('2d');
    offCtx.imageSmoothingEnabled = true;
    offCtx.drawImage(image, 0, 0, w, h);
    work = { rgba: offCtx.getImageData(0, 0, w, h).data, w, h };
    crop = { x: 0, y: 0, w, h };

    // 画布尺寸贴齐工作图，显示大小限制在 320×360 内
    sourceEl.width = w;
    sourceEl.height = h;
    const ds = Math.min(320 / w, 360 / h);
    sourceEl.style.width = Math.round(w * ds) + 'px';
    sourceEl.style.height = Math.round(h * ds) + 'px';

    repixel();
  };
  image.onerror = () => {
    statusEl.textContent = '这张图读不出来喵，换一张试试？';
  };
  image.src = dataUrl;
}

// ---- 管线：抠背景 → 裁剪 → 缩放 → 量化 ----

function repixel() {
  if (!work) return;
  let rgba = work.rgba;
  if (removeBgEl.checked) {
    rgba = window.pixelizeAPI.removeBackground(rgba, work.w, work.h, Number(toleranceEl.value));
  }
  processedCache = rgba; // 抠背景结果缓存起来，拖框过程中直接用
  const c = normalizedCrop();
  rgba = window.pixelizeAPI.crop(rgba, work.w, work.h, c.x, c.y, c.w, c.h);
  rgba = window.pixelizeAPI.fit(rgba, c.w, c.h, SPRITE_SIZE);
  quantized = window.pixelizeAPI.quantize(rgba, Number(colorsEl.value));
  resultCtx.putImageData(new ImageData(quantized, SPRITE_SIZE, SPRITE_SIZE), 0, 0);
  drawSource(rgba);
}

function normalizedCrop() {
  const x = Math.max(0, Math.min(Math.round(crop.x), work.w - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), work.h - 1));
  const w = Math.max(1, Math.min(Math.round(crop.w), work.w - x));
  const h = Math.max(1, Math.min(Math.round(crop.h), work.h - y));
  return { x, y, w, h };
}

// ---- 源图画布：显示处理结果 + 裁剪框 ----

function drawSource(processedRgba) {
  // 把（可能已抠背景的）工作图画出来，透明区域透出画布的浅色底
  sourceCtx.putImageData(new ImageData(processedRgba, work.w, work.h), 0, 0);

  const c = normalizedCrop();
  const lw = Math.max(1.5, work.w / 150);

  // 框外变暗
  sourceCtx.fillStyle = 'rgba(0,0,0,0.45)';
  sourceCtx.fillRect(0, 0, work.w, c.y);
  sourceCtx.fillRect(0, c.y + c.h, work.w, work.h - c.y - c.h);
  sourceCtx.fillRect(0, c.y, c.x, c.h);
  sourceCtx.fillRect(c.x + c.w, c.y, work.w - c.x - c.w, c.h);

  // 虚线裁剪框
  sourceCtx.strokeStyle = '#ff9a3c';
  sourceCtx.lineWidth = lw;
  sourceCtx.setLineDash([lw * 4, lw * 3]);
  sourceCtx.strokeRect(c.x + lw / 2, c.y + lw / 2, c.w - lw, c.h - lw);
  sourceCtx.setLineDash([]);
}

// ---- 拖框 ----

function toImageCoords(e) {
  const rect = sourceEl.getBoundingClientRect();
  const sx = work.w / rect.width;
  const sy = work.h / rect.height;
  return {
    x: Math.max(0, Math.min(work.w - 1, Math.round((e.clientX - rect.left) * sx))),
    y: Math.max(0, Math.min(work.h - 1, Math.round((e.clientY - rect.top) * sy))),
  };
}

sourceEl.addEventListener('mousedown', (e) => {
  if (!work || e.button !== 0) return;
  e.preventDefault();
  dragging = true;
  dragAnchor = toImageCoords(e);
  crop = { x: dragAnchor.x, y: dragAnchor.y, w: 1, h: 1 };
});

window.addEventListener('mousemove', (e) => {
  if (!dragging || !work) return;
  const p = toImageCoords(e);
  crop = {
    x: Math.min(dragAnchor.x, p.x),
    y: Math.min(dragAnchor.y, p.y),
    w: Math.abs(p.x - dragAnchor.x) + 1,
    h: Math.abs(p.y - dragAnchor.y) + 1,
  };
  // 拖动中只刷新框，松手才算一遍管线（抠背景那步有计算量）
  drawSource(currentProcessed());
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (crop.w < 4 || crop.h < 4) {
    crop = { x: 0, y: 0, w: work.w, h: work.h }; // 太小的框当误触，恢复全图
  }
  repixel();
});

// 缓存最近一次处理结果，拖框过程中复用，避免每帧都抠一遍背景
let processedCache = null;
function currentProcessed() {
  if (!processedCache) {
    let rgba = work.rgba;
    if (removeBgEl.checked) {
      rgba = window.pixelizeAPI.removeBackground(rgba, work.w, work.h, Number(toleranceEl.value));
    }
    processedCache = rgba;
  }
  return processedCache;
}

// ---- 控件联动 ----

toleranceEl.addEventListener('input', () => {
  toleranceValueEl.textContent = toleranceEl.value;
  processedCache = null;
  repixel();
});
removeBgEl.addEventListener('change', () => {
  processedCache = null;
  repixel();
});
colorsEl.addEventListener('change', repixel);

saveEl.addEventListener('click', async () => {
  if (!quantized) return;
  statusEl.textContent = '保存中…';
  const res = await window.pixelizeAPI.confirm({
    name: nameEl.value.trim() || '新形象',
    pixels: Array.from(quantized),
  });
  if (res.ok) {
    statusEl.textContent = '已换装 ✓';
    setTimeout(closeWindow, 500);
  } else {
    statusEl.textContent = res.error;
  }
});

document.getElementById('close').addEventListener('click', closeWindow);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWindow();
});

// 主进程选完图后把内容推过来；启动时也主动拉一次待处理图片（双保险防竞态）
window.pixelizeAPI.onLoadImage(loadImage);
window.pixelizeAPI.getPending().then(({ dataUrl }) => {
  if (dataUrl) loadImage(dataUrl);
});
