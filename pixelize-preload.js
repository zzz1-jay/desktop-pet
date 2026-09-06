// 像素化窗口预加载：把量化 / 抠背景 / 裁剪 / 缩放算法和保存 / 取消能力暴露给界面
// 沙箱关闭：这里要 require 本地的算法模块
const { contextBridge, ipcRenderer } = require('electron');
const { quantizeRGBA, removeBackground, cropRGBA, fitToSprite } = require('./shared/pixelize');

contextBridge.exposeInMainWorld('pixelizeAPI', {
  // 中位切分量化：输入 RGBA 像素，输出收敛到有限调色板的像素
  quantize: (rgba, maxColors) => quantizeRGBA(rgba, maxColors),
  // 容差抠背景：从四边把接近背景色的连通区域变透明
  removeBackground: (rgba, w, h, tolerance) => removeBackground(rgba, w, h, tolerance),
  crop: (rgba, w, h, x, y, cw, ch) => cropRGBA(rgba, w, h, x, y, cw, ch),
  fit: (rgba, w, h, targetSize) => fitToSprite(rgba, w, h, targetSize),
  // 保存为新形象并换装
  confirm: (payload) => ipcRenderer.invoke('pixelize:confirm', payload),
  cancel: () => ipcRenderer.send('pixelize:cancel'),
  // 主进程选完图后推来图片内容（dataURL）
  onLoadImage: (callback) => ipcRenderer.on('pixelize:load-image', (_event, payload) => callback(payload)),
  // 启动时主动拉一次待处理图片（防止推送时页面还没加载完导致丢失）
  getPending: () => ipcRenderer.invoke('pixelize:get-pending'),
});
