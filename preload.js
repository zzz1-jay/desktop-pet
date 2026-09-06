// 预加载脚本：安全地给渲染进程暴露少量能力（不开 nodeIntegration）
const { contextBridge, ipcRenderer } = require('electron');
const cat = require('./shared/cat-map');
const petConfig = require('./assets/pets/default/pet.json');

contextBridge.exposeInMainWorld('petAPI', {
  cat, // 默认形象的点阵与调色板（代码画的，不需要图片文件）
  config: petConfig, // pet.json 的内容

  // 拖拽：渲染进程只发开始 / 结束信号，移动窗口由主进程轮询鼠标完成
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  // 拖拽过程中主进程回传倾斜角度（度数），用来播放「被拎起来」的动画
  onTilt: (callback) => ipcRenderer.on('pet:tilt', (_event, deg) => callback(deg)),

  // 点一下小猫：开关聊天小窗
  toggleChat: () => ipcRenderer.send('chat:toggle'),

  // 聊天期间主进程通知开始 / 停止「说话」动画
  onTalk: (callback) => ipcRenderer.on('pet:talk', (_event, on) => callback(on)),
});
