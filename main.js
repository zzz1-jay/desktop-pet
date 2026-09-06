// 桌宠主进程：负责窗口、托盘、拖拽和位置记忆（动画都在渲染进程里）
const { app, BrowserWindow } = require('electron');
const path = require('path');

// 形象尺寸与放大倍数（与 assets/pets/default/pet.json 保持一致）
const SPRITE_SIZE = 64;
const DISPLAY_SCALE = 3;

// 窗口比画面大一圈：下方 8px 落地余量，上方留空间给弹跳动画
const WIN_W = SPRITE_SIZE * DISPLAY_SCALE + 28;
const WIN_H = SPRITE_SIZE * DISPLAY_SCALE + 48;

let petWindow = null;

function createPetWindow() {
  petWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
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
    },
  });

  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
}

app.whenReady().then(() => {
  createPetWindow();
});

app.on('window-all-closed', () => {
  // 桌宠没有关闭按钮，窗口没了就退出（托盘在 M1-4 加入）
  app.quit();
});
