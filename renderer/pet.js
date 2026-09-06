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
      drawFrame(cat.frames.open);
      scheduleBlink();
    }, anim.blinkDurationMs);
  }, delay);
}

drawFrame(cat.frames.open);
scheduleBlink();

// ---- 点击弹跳 ----
bounceLayer.addEventListener('animationend', () => bounceLayer.classList.remove('bounce'));

function bounce() {
  bounceLayer.classList.remove('bounce');
  void bounceLayer.offsetWidth; // 强制重排，让动画可以连续触发
  bounceLayer.classList.add('bounce');
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
    bounce();
    window.petAPI.toggleChat(); // 点一下小猫：弹跳 + 开关聊天小窗
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

// ---- 拖拽倾斜：角度由主进程按鼠标移动方向回传 ----
window.petAPI.onTilt((deg) => {
  tiltLayer.style.transform = deg ? `rotate(${deg}deg)` : '';
});
