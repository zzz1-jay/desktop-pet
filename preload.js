// 预加载脚本：安全地给渲染进程暴露少量能力（不开 nodeIntegration）
// 沙箱需要关闭，因为这里要 require 本地模块（cat-map）和读取形象文件
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const cat = require('./shared/cat-map');

// 当前激活的形象（assets/pets/active.json 指向的目录）
function getActiveFolder() {
  try {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'pets', 'active.json'), 'utf8')).folder;
    return typeof f === 'string' ? f : 'default';
  } catch {
    return 'default';
  }
}

const petDir = path.join(__dirname, 'assets', 'pets', getActiveFolder());
const petConfig = JSON.parse(fs.readFileSync(path.join(petDir, 'pet.json'), 'utf8'));

// 自定义形象（照片像素化）的精灵图；代码画的默认猫用 cat-map，不需要图
let spriteDataUrl = null;
if (petConfig.kind === 'image') {
  spriteDataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(petDir, 'sprite.png')).toString('base64');
}

contextBridge.exposeInMainWorld('petAPI', {
  cat, // 默认形象的点阵与调色板（代码画的，不需要图片文件）
  config: petConfig, // 当前形象 pet.json 的内容
  spriteDataUrl, // 自定义形象的精灵图（kind === 'image' 时才有）

  // 拖拽：渲染进程只发开始 / 结束信号，移动窗口由主进程轮询鼠标完成
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  // 拖拽过程中主进程回传倾斜角度（度数），用来播放「被拎起来」的动画
  onTilt: (callback) => ipcRenderer.on('pet:tilt', (_event, deg) => callback(deg)),

  // 右键小猫：弹出快捷菜单（聊一聊 / 设置）
  showMenu: () => ipcRenderer.send('pet:menu'),

  // 聊天期间主进程通知开始 / 停止「说话」动画
  onTalk: (callback) => ipcRenderer.on('pet:talk', (_event, on) => callback(on)),

  // 换形象 / 改显示大小后，主进程推来新的配置和精灵图
  onConfigChanged: (callback) => ipcRenderer.on('pet:config-changed', (_event, payload) => callback(payload)),
});
