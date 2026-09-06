// 预加载脚本：安全地给渲染进程暴露少量能力（不开 nodeIntegration）
const { contextBridge } = require('electron');
const cat = require('./shared/cat-map');
const petConfig = require('./assets/pets/default/pet.json');

contextBridge.exposeInMainWorld('petAPI', {
  cat, // 默认形象的点阵与调色板（代码画的，不需要图片文件）
  config: petConfig, // pet.json 的内容
  // M1-3 会在这里加入拖拽所需的 IPC 方法
});
