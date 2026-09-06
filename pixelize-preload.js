// 像素化窗口预加载：把量化算法和保存 / 取消能力暴露给界面
// 沙箱关闭：这里要 require 本地的量化模块
const { contextBridge, ipcRenderer } = require('electron');
const { quantizeRGBA } = require('./shared/pixelize');

contextBridge.exposeInMainWorld('pixelizeAPI', {
  // 中位切分量化：输入 RGBA 像素，输出收敛到有限调色板的像素
  quantize: (rgba, maxColors) => quantizeRGBA(rgba, maxColors),
  // 保存为 新形象并换装
  confirm: (payload) => ipcRenderer.invoke('pixelize:confirm', payload),
  cancel: () => ipcRenderer.send('pixelize:cancel'),
  // 主进程选完图后推来图片内容（dataURL）
  onLoadImage: (callback) => ipcRenderer.on('pixelize:load-image', (_event, payload) => callback(payload)),
});
