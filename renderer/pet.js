// 桌宠渲染进程：画形象 + 全部程序动画（浮动 / 眨眼 / 弹跳 / 拖拽倾斜 / 说话）
// 两种形象都能渲染：
//   代码猫 —— 用 shared/cat-map 的点阵画出来，支持眨眼 / 张嘴帧
//   图片形象 —— 上传照片像素化后的 sprite.png，动画用程序变换（浮动/倾斜/弹跳/点头）
const { cat, config: initialConfig, spriteDataUrl: initialSprite } = window.petAPI;

const canvas = document.getElementById('pet');
const ctx = canvas.getContext('2d');
const floatLayer = document.getElementById('float');
const tiltLayer = document.getElementById('tilt');
const bounceLayer = document.getElementById('bounce');

// 拍拍时头顶冒出的像素爱心（画一次，位置和大小在 applyConfig 里跟随形象调整）
const heartCanvas = document.getElementById('heart');
const HEART_MAP = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
const heartCtx = heartCanvas.getContext('2d');
HEART_MAP.forEach((row, y) => {
  [...row].forEach((ch, x) => {
    if (ch === '1') {
      heartCtx.fillStyle = '#f06292';
      heartCtx.fillRect(x, y, 1, 1);
    }
  });
});

let config = initialConfig;
let anim = config.animation || {};
let catFrames = initialSprite ? null : cat.frames; // 代码猫才有点阵帧
let spriteImg = null; // 图片形象的 Image 对象

// 把一套点阵（每行一个字符串，字符对应调色板颜色）画到画布上
function drawRows(rows) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      ctx.fillStyle = cat.palette[ch];
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawImageSprite() {
  if (!spriteImg || !spriteImg.complete) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(spriteImg, 0, 0, canvas.width, canvas.height);
}

// 当前应该显示的画面：说话时张嘴 / 点头，平时睁眼待机
function drawCurrent() {
  if (spriteImg) {
    drawImageSprite();
    return;
  }
  if (talking && talkPhase) {
    drawRows(catFrames.talk);
  } else {
    drawRows(catFrames.open);
  }
}

// 应用形象配置（首次启动和换形象 / 改大小共用）
function applyConfig(newConfig, spriteDataUrl) {
  config = newConfig;
  anim = config.animation || {};
  canvas.width = config.size;
  canvas.height = config.size;
  canvas.style.width = config.size * config.displayScale + 'px';
  canvas.style.height = config.size * config.displayScale + 'px';

  catFrames = spriteDataUrl ? null : cat.frames;
  if (spriteDataUrl) {
    const img = new Image();
    img.onload = () => {
      if (img === spriteImg) drawCurrent();
    };
    img.src = spriteDataUrl;
    spriteImg = img;
  } else {
    spriteImg = null;
  }

  // 待机浮动参数
  floatLayer.style.animationDuration = (anim.floatPeriodMs || 3200) + 'ms';
  floatLayer.style.setProperty('--float-amp', (anim.floatAmplitudePx || 6) + 'px');

  // 爱心特效：贴在头顶上方，大小跟着形象缩放（写死像素的话换倍数就会消失/错位）；
  // 上方余量固定 40px，爱心最大不超过 32px 宽，保证任何倍数都完整显示
  const displayH = config.size * config.displayScale;
  const heartW = Math.min(32, Math.max(24, Math.round(displayH * 0.16)));
  heartCanvas.style.bottom = 8 + displayH + 6 + 'px';
  heartCanvas.style.width = heartW + 'px';
  heartCanvas.style.height = Math.round((heartW * 6) / 7) + 'px';
  heartCanvas.style.marginLeft = -Math.round(heartW / 2) + 'px';
}

// ---- 说话反应：聊天窗等 AI 回复时，猫张嘴、图片形象点头 ----
let talking = false;
let talkPhase = 0;

setInterval(() => {
  if (!talking) return;
  talkPhase = 1 - talkPhase;
  if (spriteImg) {
    bounceLayer.style.transform = talkPhase ? 'translateY(2px)' : 'translateY(0)';
  } else {
    drawCurrent();
  }
}, 180);

window.petAPI.onTalk((on) => {
  talking = on;
  talkPhase = 0;
  bounceLayer.style.transform = 'translateY(0)';
  drawCurrent();
});

// ---- 眨眼：只有代码猫有点阵帧可以换（随机间隔闭眼一小会儿） ----
function scheduleBlink() {
  if (!catFrames) return;
  const min = anim.blinkMinMs || 2500;
  const max = anim.blinkMaxMs || 6000;
  const delay = min + Math.random() * (max - min);
  setTimeout(() => {
    if (!catFrames) return; // 已切换成图片形象，不眨眼
    drawRows(catFrames.blink);
    setTimeout(() => {
      drawCurrent();
      scheduleBlink();
    }, anim.blinkDurationMs || 140);
  }, delay);
}

applyConfig(config, initialSprite);
drawCurrent();
scheduleBlink();

// ---- 点击弹跳 ----
bounceLayer.addEventListener('animationend', () => bounceLayer.classList.remove('bounce'));

function bounce() {
  bounceLayer.classList.remove('bounce');
  void bounceLayer.offsetWidth; // 强制重排，让动画可以连续触发
  bounceLayer.classList.add('bounce');
}

// ---- 拍拍反应：眯眼笑（代码猫）+ 弹跳 + 头顶冒像素爱心 ----
let patTimer = null;

function pat() {
  bounce();
  if (catFrames) {
    // 被拍得美滋滋：眯眼笑一会儿
    clearTimeout(patTimer);
    drawRows(catFrames.blink);
    patTimer = setTimeout(() => drawCurrent(), 650);
  }
  // 冒爱心
  heartCanvas.classList.remove('pop');
  void heartCanvas.offsetWidth;
  heartCanvas.classList.add('pop');
}

// ---- 拖拽 + 点击判定 ----
// 按住基本没动 → 算「点击」，播放拍拍反应；拖动了 → 主进程负责移动窗口
let pressing = false;
let pressAt = 0;
let moved = 0;

function startPress() {
  pressing = true;
  pressAt = Date.now();
  moved = 0;
  document.body.classList.add('dragging');
  window.petAPI.dragStart();
}

function endPress() {
  if (!pressing) return;
  pressing = false;
  document.body.classList.remove('dragging');
  window.petAPI.dragEnd();
  if (moved < 5 && Date.now() - pressAt < 250) {
    pat(); // 左键点一下 = 拍拍它
  }
}

window.addEventListener('mousedown', (e) => {
  if (e.button === 0) startPress();
});
window.addEventListener('mousemove', (e) => {
  if (pressing) moved += Math.abs(e.movementX) + Math.abs(e.movementY);
});
window.addEventListener('mouseup', endPress);
window.addEventListener('blur', endPress); // 焦点丢失时兜底，防止卡在拖拽状态

// 右键 = 快捷菜单（聊一聊 / 设置），菜单由主进程弹出
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.petAPI.showMenu();
});

// ---- 拖拽倾斜：角度由主进程按鼠标移动方向回传 ----
window.petAPI.onTilt((deg) => {
  tiltLayer.style.transform = deg ? `rotate(${deg}deg)` : '';
});

// ---- 换形象 / 改显示大小：主进程推来新配置，热更新 ----
window.petAPI.onConfigChanged(({ config: newConfig, spriteDataUrl }) => {
  applyConfig(newConfig, spriteDataUrl);
  drawCurrent();
});
