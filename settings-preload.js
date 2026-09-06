// 设置窗预加载：统一的个性化入口（形象 / 名字 / 人设 / 大小），沙箱保持开启
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (data) => ipcRenderer.invoke('settings:save', data),
  close: () => ipcRenderer.send('settings:close'),
  // 形象管理：列表 / 切换 / 删除 / 上传图片生成新形象
  listPets: () => ipcRenderer.invoke('pets:list'),
  switchPet: (folder) => ipcRenderer.invoke('pets:switch', folder),
  deletePet: (folder) => ipcRenderer.invoke('pets:delete', folder),
  openUpload: () => ipcRenderer.send('pixelize:open'),
  // 换形象 / 切换后主进程通知设置窗刷新
  onRefresh: (callback) => ipcRenderer.on('settings:refresh', () => callback()),
});
