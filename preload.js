// 预加载脚本：安全地给渲染进程暴露少量能力（不开 nodeIntegration）
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // M1-3 会在这里加入拖拽所需的 IPC 方法
});
