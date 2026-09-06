// 桌宠渲染进程：画猫 + 全部程序动画（浮动 / 眨眼 / 弹跳 / 拖拽倾斜）
const { cat, config } = window.petAPI;
const anim = config.animation;

const canvas = document.getElementById('pet');
canvas.width = cat.size;
canvas.height = cat.size;
canvas.style.width = cat.size * config.displayScale + 'px';
canvas.style.height = cat.size * config.displayScale + 'px';

const ctx = canvas.getContext('2d');
const floatLayer = document.getElementById('float');
const tiltLayer = document.getElementById('tilt');
const bounceLayer = document.getElementById('bounce');

// 把一套点阵（每行一个字符串，字符对应调色板颜色）画到画布上
function drawFrame(rows) {
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

// ---- 待机浮动：参数来自 pet.json ----
floatLayer.style.animationDuration = anim.floatPeriodMs + 'ms';
floatLayer.style.setProperty('--float-amp', anim.floatAmplitudePx + 'px');

// ---- 眨眼：随机间隔切到闭眼帧一小会儿 ----
function scheduleBlink() {
  const delay = anim.blinkMinMs + Math.random() * (anim.blinkMaxMs - anim.blinkMinMs);
  setTimeout(() => {
    drawFrame(cat.frames.blink);
    setTimeout(() => {
      drawCurrent();
      scheduleBlink();
    }, anim.blinkDurationMs);
  }, delay);
}

// ---- 说话反应：聊天窗等 AI 回复时，嘴巴一张一合 ----
let talking = false;
let talkPhase = 0;

// 当前应该显示的帧（说话时在张嘴 / 闭嘴之间切换）
function drawCurrent() {
  drawFrame(talking && talkPhase ? cat.frames.talk : cat.frames.open);
}

setInterval(() => {
  if (!talking) return;
  talkPhase = 1 - talkPhase;
  drawCurrent();
}, 180);

window.petAPI.onTalk((on) => {
  talking = on;
  talkPhase = 0;
  drawCurrent();
});

drawFrame(cat.frames.open);
scheduleBlink();

// ---- 点击弹跳 ----
bounceLayer.addEventListener('animationend', () => bounceLayer.classList.remove('bounce'));

function bounce() {
  bounceLayer.classList.remove('bounce');
  void bounceLayer.offsetWidth; // 强制重排，让动画可以连续触发
  bounceLayer.classList.add('bounce');
}

// ---- 拍拍反应：眯眼笑 + 弹跳 + 头顶冒像素爱心 ----
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

let patTimer = null;

function pat() {
  bounce();
  // 被拍得美滋滋：眯眼笑一会儿
  clearTimeout(patTimer);
  drawFrame(cat.frames.blink);
  patTimer = setTimeout(() => drawCurrent(), 650);
  // 冒爱心
  heartCanvas.classList.remove('pop');
  void heartCanvas.offsetWidth;
  heartCanvas.classList.add('pop');
}

// ---- 拖拽 + 点击判定 ----
// 按住基本没动 → 算「点击」，播放弹跳；拖动了 → 主进程负责移动窗口
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

// 右键 = 快捷菜单（聊天 / 换形象 / 改名字与人设 / 退出），菜单由主进程弹出
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.petAPI.showMenu();
});

window.addEventListener('mousedown', (e) => {
  if (e.button === 0) startPress();
});
window.addEventListener('mousemove', (e) => {
  if (pressing) moved += Math.abs(e.movementX) + Math.abs(e.movementY);
});
window.addEventListener('mouseup', endPress);
window.addEventListener('blur', endPress); // 焦点丢失时兜底，防止卡在拖拽状态

// ---- 拖拽倾斜：角度由主进程按鼠标移动方向回传 ----
window.petAPI.onTilt((deg) => {
  tiltLayer.style.transform = deg ? `rotate(${deg}deg)` : '';
});
