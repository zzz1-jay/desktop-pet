// 像素化窗口渲染进程：原图 → 缩到 64×64 → 中位切分量化 → 预览 → 保存换装
const sourceEl = document.getElementById('source');
const resultEl = document.getElementById('result');
const colorsEl = document.getElementById('colors');
const nameEl = document.getElementById('pet-name');
const statusEl = document.getElementById('status');
const saveEl = document.getElementById('save');

const sourceCtx = sourceEl.getContext('2d');
const resultCtx = resultEl.getContext('2d');

const SPRITE_SIZE = 64;
let img = null; // 原图
let quantized = null; // 最近一次量化的像素（Uint8ClampedArray）

function closeWindow() {
  window.pixelizeAPI.cancel();
}

function drawSource() {
  // 原图等比缩到 240×240 内，居中显示
  sourceCtx.fillStyle = '#f3ede4';
  sourceCtx.fillRect(0, 0, sourceEl.width, sourceEl.height);
  const scale = Math.min(sourceEl.width / img.width, sourceEl.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  sourceCtx.imageSmoothingEnabled = true;
  sourceCtx.drawImage(img, (sourceEl.width - w) / 2, (sourceEl.height - h) / 2, w, h);
}

// 核心管线：64×64 缩放（区域平均）→ 中位切分量化 → 结果画布
function repixel() {
  if (!img) return;
  const off = document.createElement('canvas');
  off.width = SPRITE_SIZE;
  off.height = SPRITE_SIZE;
  const offCtx = off.getContext('2d');
  offCtx.imageSmoothingEnabled = true; // 缩小时做平均，避免丢细节
  offCtx.drawImage(img, 0, 0, SPRITE_SIZE, SPRITE_SIZE);

  const data = offCtx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  quantized = window.pixelizeAPI.quantize(data.data, Number(colorsEl.value));
  resultCtx.putImageData(new ImageData(quantized, SPRITE_SIZE, SPRITE_SIZE), 0, 0);
}

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

// 主进程选完图后把内容推过来
window.pixelizeAPI.onLoadImage(({ dataUrl }) => {
  const image = new Image();
  image.onload = () => {
    img = image;
    drawSource();
    repixel();
  };
  image.src = dataUrl;
});
