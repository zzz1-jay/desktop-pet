// 聊天窗预加载：只暴露关闭和提问两个能力（沙箱保持开启，不需要 require 本地模块）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatAPI', {
  close: () => ipcRenderer.send('chat:close'),
  // 阶段 2-2 接入：ask(messages) 调用主进程请求 GLM-4-Flash
  ask: (messages) => ipcRenderer.invoke('chat:ask', messages),
  // 当前形象信息：加载后主动拉一次 + 每次显示时被动接收
  getMeta: () => ipcRenderer.invoke('chat:get-meta'),
  onMeta: (callback) => ipcRenderer.on('chat:meta', (_event, meta) => callback(meta)),
});
