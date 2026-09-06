// 桌宠主进程：负责窗口、托盘、拖拽和位置记忆（动画都在渲染进程里）
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./shared/png');
const cat = require('./shared/cat-map');

const PET_DIR = path.join(__dirname, 'assets', 'pets', 'default');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

// 默认形象的配置。首次运行时写成 pet.json，之后想调参数直接改那个文件。
const DEFAULT_PET = {
  name: '小橘',
  sprite: 'sprite.png',
  size: cat.size,
  displayScale: 3,
  animation: {
    floatPeriodMs: 3200,
    floatAmplitudePx: 6,
    blinkMinMs: 2500,
    blinkMaxMs: 6000,
    blinkDurationMs: 140,
    tiltDeg: 8,
  },
};

// 点阵 → 64×64 的 PNG 文件内容
function renderSpritePNG() {
  const n = cat.size;
  const rgba = Buffer.alloc(n * n * 4);
  const rgb = {};
  for (const [ch, hex] of Object.entries(cat.palette)) {
    rgb[ch] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  cat.frames.open.forEach((row, y) => {
    for (let x = 0; x < n; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const [r, g, b] = rgb[ch];
      const i = (y * n + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  });
  return encodePNG(rgba, n, n);
}

// 首次运行时把代码画的小猫落盘，建立「一个形象 = 一个文件夹」的结构
function ensureDefaultPet() {
  fs.mkdirSync(PET_DIR, { recursive: true });
  const spritePath = path.join(PET_DIR, 'sprite.png');
  if (!fs.existsSync(spritePath)) fs.writeFileSync(spritePath, renderSpritePNG());
  const configPath = path.join(PET_DIR, 'pet.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_PET, null, 2) + '\n');
  }
}

ensureDefaultPet();
const petConfig = JSON.parse(fs.readFileSync(path.join(PET_DIR, 'pet.json'), 'utf8'));

// 窗口比画面大一圈：下方 8px 落地余量，上方留空间给弹跳动画
const WIN_W = petConfig.size * petConfig.displayScale + 28;
const WIN_H = petConfig.size * petConfig.displayScale + 48;

// 聊天小窗尺寸
const CHAT_W = 340;
const CHAT_H = 460;

let petWindow = null;
let chatWindow = null;
let tray = null;
let isQuitting = false;

// ---- 位置记忆：存 / 读 data/state.json ----

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [x, y] = petWindow.getPosition();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ x, y }, null, 2) + '\n');
  } catch {
    // 存不上就算了，位置记忆不是关键功能
  }
}

// 上次的位置可能已经不在任何屏幕上了（比如拔了显示器），这时回退到默认位置
function pickWindowPosition(state) {
  const { workArea } = screen.getPrimaryDisplay();
  const defaultPos = { x: workArea.x + workArea.width - WIN_W - 40, y: workArea.y + workArea.height - WIN_H - 8 };
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return defaultPos;
  const onSomeScreen = screen.getAllDisplays().some((d) => {
    const { x, y, width, height } = d.workArea;
    return state.x >= x - WIN_W + 40 && state.x < x + width - 40 && state.y >= y && state.y < y + height - 40;
  });
  return onSomeScreen ? { x: state.x, y: state.y } : defaultPos;
}

function createPetWindow() {
  const pos = pickWindowPosition(loadState());
  petWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 里要 require 本地模块（cat-map / pet.json），需要关掉沙箱
    },
  });

  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
}

// ---- 托盘 ----

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(PET_DIR, 'sprite.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(`小桌宠 · ${petConfig.name}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '换形象（开发中）', enabled: false },
      { label: '设置（开发中）', enabled: false },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ])
  );
  tray.on('click', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.show();
  });
}

// ---- 聊天小窗 ----

function createChatWindow() {
  chatWindow = new BrowserWindow({
    width: CHAT_W,
    height: CHAT_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 沙箱保持默认开启：chat-preload 只用 electron API，不需要 require 本地模块
    },
  });

  chatWindow.loadFile(path.join(__dirname, 'renderer', 'chat.html'));

  // 点 × 只是藏起来，下次打开更快；真正退出时才销毁
  chatWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      chatWindow.hide();
    }
  });
}

// 聊天窗贴着桌宠放：优先放左边，放不下放右边，整体收紧到屏幕工作区内
function positionChatWindow() {
  const [px, py] = petWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: px, y: py });
  const wa = display.workArea;

  let x = px - CHAT_W - 8;
  if (x < wa.x) x = px + WIN_W + 8;
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - CHAT_W);

  let y = py - 60;
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - CHAT_H);

  chatWindow.setPosition(x, y);
}

ipcMain.on('chat:toggle', () => {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (!chatWindow || chatWindow.isDestroyed()) createChatWindow();
  if (chatWindow.isVisible()) {
    chatWindow.hide();
    return;
  }
  positionChatWindow();
  chatWindow.show();
  chatWindow.focus();
});

ipcMain.on('chat:close', () => {
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.hide();
});

// ---- 拖拽：主进程每 16ms 读一次鼠标位置，把窗口「贴」在鼠标上 ----
// 渲染进程只发开始 / 结束信号；顺便按鼠标横向移动量回传倾斜角度
const tiltDeg = petConfig.animation.tiltDeg;
let dragTimer = null;
let dragOffset = { x: 0, y: 0 };
let lastCursor = { x: 0, y: 0 };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

ipcMain.on('pet:drag-start', () => {
  if (!petWindow || petWindow.isDestroyed() || dragTimer) return;
  const cursor = screen.getCursorScreenPoint();
  const [winX, winY] = petWindow.getPosition();
  dragOffset = { x: cursor.x - winX, y: cursor.y - winY };
  lastCursor = cursor;
  dragTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return stopDragging();
    const c = screen.getCursorScreenPoint();
    petWindow.setPosition(c.x - dragOffset.x, c.y - dragOffset.y);
    const dx = c.x - lastCursor.x;
    lastCursor = c;
    petWindow.webContents.send('pet:tilt', clamp(dx * 0.5, -tiltDeg, tiltDeg));
  }, 16);
});

ipcMain.on('pet:drag-end', () => {
  stopDragging();
  saveState(); // 拖完就存位置
});

function stopDragging() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:tilt', 0);
}

// ---- 应用生命周期 ----

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // 已经有一只桌宠在跑了，直接退出本次启动
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.show();
      petWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createPetWindow();
    createTray();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopDragging();
    saveState();
    if (tray) tray.destroy();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
