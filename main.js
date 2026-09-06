// 桌宠主进程：负责窗口、托盘、拖拽和位置记忆（动画都在渲染进程里）
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./shared/png');
const cat = require('./shared/cat-map');

const PETS_DIR = path.join(__dirname, 'assets', 'pets');
const ACTIVE_PET_PATH = path.join(PETS_DIR, 'active.json');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

// 当前使用的形象目录名（换装 / 切换时写入 active.json）
function getActiveFolder() {
  try {
    const f = JSON.parse(fs.readFileSync(ACTIVE_PET_PATH, 'utf8')).folder;
    return typeof f === 'string' ? f : 'default';
  } catch {
    return 'default';
  }
}

function getPetDir(folder) {
  return path.join(PETS_DIR, folder);
}

function loadPetConfig(folder) {
  return JSON.parse(fs.readFileSync(path.join(getPetDir(folder), 'pet.json'), 'utf8'));
}

// 精灵图读成 dataURL（设置窗头像 / 自定义形象渲染用）
function readSpriteDataUrl(folder) {
  const p = path.join(getPetDir(folder), 'sprite.png');
  if (!fs.existsSync(p)) return null;
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}

// 小橘的默认人设（每个形象在 pet.json 里存自己的 persona，换形象即换人设）
const CAT_PERSONA =
  '你是「小橘」，一只圆滚滚的橘色像素小猫桌宠，住在主人的 Windows 桌面上。' +
  '性格黏人、好奇、有点贪吃。用简短的中文回答（一般不超过两三句话），语气可爱自然，' +
  '偶尔可以用「喵」或颜文字收尾，但不要每句都用。' +
  '如果主人问正经问题（比如学习、技术），就认真、简洁、准确地回答，保持小橘的角色感即可。';

// 默认形象的配置。首次运行时写成 pet.json，之后想调参数直接改那个文件。
const DEFAULT_PET = {
  name: '小橘',
  persona: CAT_PERSONA,
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

// 首次运行时把代码画的小猫落盘，建立「一个形象 = 一个文件夹」的结构；
// 老版本的 pet.json 如果没有人设字段，补上默认人设
function ensureDefaultPet() {
  const petDir = getPetDir('default');
  fs.mkdirSync(petDir, { recursive: true });
  const spritePath = path.join(petDir, 'sprite.png');
  if (!fs.existsSync(spritePath)) fs.writeFileSync(spritePath, renderSpritePNG());
  const configPath = path.join(petDir, 'pet.json');
  let cfg = null;
  if (fs.existsSync(configPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      cfg = null;
    }
  }
  if (!cfg) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_PET, null, 2) + '\n');
  } else if (!cfg.persona) {
    cfg.persona = DEFAULT_PET.persona;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
  }
}

ensureDefaultPet();
let activeFolder = getActiveFolder();
let petConfig = loadPetConfig(activeFolder);

// 窗口尺寸跟着当前形象的显示大小走；下方 8px 落地余量，上方留空间给弹跳动画
function petWindowSize() {
  return {
    width: petConfig.size * petConfig.displayScale + 28,
    height: petConfig.size * petConfig.displayScale + 48,
  };
}

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
  const { width: w, height: h } = petWindowSize();
  const defaultPos = { x: workArea.x + workArea.width - w - 40, y: workArea.y + workArea.height - h - 8 };
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return defaultPos;
  const onSomeScreen = screen.getAllDisplays().some((d) => {
    const { x, y, width, height } = d.workArea;
    return state.x >= x - w + 40 && state.x < x + width - 40 && state.y >= y && state.y < y + height - 40;
  });
  return onSomeScreen ? { x: state.x, y: state.y } : defaultPos;
}

function createPetWindow() {
  const pos = pickWindowPosition(loadState());
  const { width, height } = petWindowSize();
  petWindow = new BrowserWindow({
    width,
    height,
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

function buildTrayIcon() {
  const size = 32;
  const img = nativeImage
    .createFromPath(path.join(getPetDir(activeFolder), 'sprite.png'))
    .resize({ width: size, height: size });

  // 代码猫的精灵图自带透明背景，直接用；
  // 照片形象是方形不透明的，裁成「圆形头像 + 透明边距」才不会在托盘里糊成一个小色块
  if (petConfig.kind !== 'image') return img;

  const inner = size - 4;
  const src = Buffer.from(img.resize({ width: inner, height: inner }).getBitmap());
  const out = Buffer.alloc(size * size * 4);
  const off = 2;
  for (let y = 0; y < inner; y++) {
    src.copy(out, ((y + off) * size + off) * 4, y * inner * 4, (y + 1) * inner * 4);
  }
  const r = inner / 2;
  const c = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      if (dx * dx + dy * dy > r * r) {
        const i = (y * size + x) * 4;
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBitmap(out, { width: size, height: size });
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip(`小桌宠 · ${petConfig.name}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '设置（形象 / 人设 / 大小）',
        click: () => openSettingsWindow(),
      },
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
  const { width: w } = petWindowSize();

  let x = px - CHAT_W - 8;
  if (x < wa.x) x = px + w + 8;
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - CHAT_W);

  let y = py - 60;
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - CHAT_H);

  chatWindow.setPosition(x, y);
}

function showChatWindow() {
  if (!chatWindow || chatWindow.isDestroyed()) createChatWindow();
  positionChatWindow();
  chatWindow.show();
  chatWindow.focus();
  // 聊天窗标题用当前形象的名字（设置里改了名字要能跟着变）
  chatWindow.webContents.send('chat:meta', { name: petConfig.name });
}

ipcMain.on('chat:toggle', () => {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
    chatWindow.hide();
    return;
  }
  showChatWindow();
});

ipcMain.on('chat:close', () => {
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.hide();
});

// 聊天窗加载完成后主动问一次当前形象信息（避免显示时机竞态）
ipcMain.handle('chat:get-meta', () => ({ name: petConfig.name }));

// 右键小猫弹出的快捷菜单：只保留两项，其他个性化都在设置窗口里
ipcMain.on('pet:menu', () => {
  if (!petWindow || petWindow.isDestroyed()) return;
  Menu.buildFromTemplate([
    {
      label: `🐾 聊一聊`,
      click: () => showChatWindow(),
    },
    {
      label: '⚙️ 设置',
      click: () => openSettingsWindow(),
    },
  ]).popup({ window: petWindow });
});

// ---- 设置窗口：改名字 / 编辑人设提示词 ----

const SETTINGS_W = 380;
const SETTINGS_H = 680;
let settingsWindow = null;

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: SETTINGS_W,
    height: SETTINGS_H,
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
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 沙箱保持默认开启：settings-preload 只用 electron API
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  settingsWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      settingsWindow.hide();
    }
  });
}

function openSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
  if (!settingsWindow.isVisible()) {
    // 贴着桌宠放：优先放右边，放不下放左边
    const [px, py] = petWindow.getPosition();
    const display = screen.getDisplayNearestPoint({ x: px, y: py });
    const wa = display.workArea;
    const { width: w } = petWindowSize();

    let x = px + w + 8;
    if (x + SETTINGS_W > wa.x + wa.width) x = px - SETTINGS_W - 8;
    x = Math.min(Math.max(x, wa.x), wa.x + wa.width - SETTINGS_W);

    let y = Math.min(Math.max(py, wa.y), wa.y + wa.height - SETTINGS_H);
    settingsWindow.setPosition(x, y);
  }
  settingsWindow.show();
  settingsWindow.focus();
}

// ---- 形象切换 ----

// 切换到指定形象：改指针、重载配置、通知桌宠窗口和设置窗、托盘图标跟着换
function switchToPet(folder) {
  const dir = getPetDir(folder);
  if (!fs.existsSync(path.join(dir, 'pet.json'))) return { ok: false, error: '形象不存在喵' };

  activeFolder = folder;
  petConfig = loadPetConfig(folder);
  fs.writeFileSync(ACTIVE_PET_PATH, JSON.stringify({ folder }, null, 2) + '\n');

  applyPetWindowSize();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:config-changed', {
      config: petConfig,
      spriteDataUrl: petConfig.kind === 'image' ? readSpriteDataUrl(folder) : null,
    });
  }
  if (tray) {
    tray.setImage(buildTrayIcon());
    tray.setToolTip(`小桌宠 · ${petConfig.name}`);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:refresh');
  }
  return { ok: true };
}

// 显示大小变化时，桌宠窗口尺寸实时跟上
function applyPetWindowSize() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const { width, height } = petWindowSize();
  petWindow.setResizable(true);
  petWindow.setSize(width, height);
  petWindow.setResizable(false);
}

ipcMain.handle('pets:list', () => {
  const out = [];
  for (const entry of fs.readdirSync(PETS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(getPetDir(entry.name), 'pet.json');
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      out.push({
        folder: entry.name,
        name: cfg.name || entry.name,
        active: entry.name === activeFolder,
        spriteDataUrl: readSpriteDataUrl(entry.name),
      });
    } catch {
      // 某个形象目录坏了就跳过，别影响其他的
    }
  }
  return out;
});

ipcMain.handle('pets:switch', (_event, folder) => switchToPet(String(folder)));

ipcMain.handle('settings:load', () => ({
  name: petConfig.name,
  persona: petConfig.persona || '',
  displayScale: petConfig.displayScale,
  folder: activeFolder,
  spriteDataUrl: readSpriteDataUrl(activeFolder),
}));

ipcMain.handle('settings:save', (_event, data) => {
  const name = String(data?.name || '').trim();
  const persona = String(data?.persona || '').trim();
  const scale = Number(data?.displayScale);
  if (!name) return { ok: false, error: '名字不能为空喵' };
  if (!persona) return { ok: false, error: '人设提示词不能为空喵（不然 AI 就不认识自己啦）' };
  if (!Number.isInteger(scale) || scale < 2 || scale > 6) {
    return { ok: false, error: '显示大小要在 2~6 倍之间喵' };
  }

  // 更新内存与磁盘（pet.json 的其他字段原样保留）
  petConfig.name = name;
  petConfig.persona = persona;
  const sizeChanged = scale !== petConfig.displayScale;
  petConfig.displayScale = scale;
  try {
    fs.writeFileSync(path.join(getPetDir(activeFolder), 'pet.json'), JSON.stringify(petConfig, null, 2) + '\n');
  } catch (err) {
    return { ok: false, error: `保存失败：${err.message || err}` };
  }

  if (tray) tray.setToolTip(`小桌宠 · ${name}`);
  if (sizeChanged) applyPetWindowSize();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:config-changed', {
      config: petConfig,
      spriteDataUrl: petConfig.kind === 'image' ? readSpriteDataUrl(activeFolder) : null,
    });
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('chat:meta', { name });
  }
  return { ok: true };
});

ipcMain.on('settings:close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
});

// ---- 上传图片 → 像素化 → 换装 ----

const PIXELIZE_W = 760;
const PIXELIZE_H = 880;
let pixelizeWindow = null;
let pendingPixelizeImage = null; // 选好但还没交给像素化窗口的图片
let lastImportDir = null; // 上次成功导入的文件夹（对话框从这儿打开，方便连着传图）

function createPixelizeWindow() {
  pixelizeWindow = new BrowserWindow({
    width: PIXELIZE_W,
    height: PIXELIZE_H,
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
      preload: path.join(__dirname, 'pixelize-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // pixelize-preload 要 require 本地的量化模块
    },
  });

  pixelizeWindow.loadFile(path.join(__dirname, 'renderer', 'pixelize.html'));

  pixelizeWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      pixelizeWindow.hide();
    }
  });
}

ipcMain.on('pixelize:open', async () => {
  // 弹系统文件选择框：从上次导入的文件夹打开（第一次从桌面开始），
  // 否则 Windows 会一直停在旧目录，看起来像「只能传同一张图」
  const res = await dialog.showOpenDialog({
    title: '选一张图片生成像素形象',
    defaultPath: lastImportDir || app.getPath('desktop'),
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (res.canceled || !res.filePaths[0]) return;

  const filePath = res.filePaths[0];
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  pendingPixelizeImage = `data:image/${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  lastImportDir = path.dirname(filePath);

  if (!pixelizeWindow || pixelizeWindow.isDestroyed()) createPixelizeWindow();
  pixelizeWindow.show();
  pixelizeWindow.focus();

  // 推送 + 渲染进程启动时主动拉取（get-pending）双保险，避免加载时序竞态
  const deliver = () => {
    if (pendingPixelizeImage && pixelizeWindow && !pixelizeWindow.isDestroyed()) {
      pixelizeWindow.webContents.send('pixelize:load-image', { dataUrl: pendingPixelizeImage });
    }
  };
  if (pixelizeWindow.webContents.isLoading()) {
    pixelizeWindow.webContents.once('did-finish-load', deliver);
  } else {
    deliver();
  }
});

ipcMain.handle('pixelize:get-pending', () => ({ dataUrl: pendingPixelizeImage }));

ipcMain.on('pixelize:cancel', () => {
  if (pixelizeWindow && !pixelizeWindow.isDestroyed()) pixelizeWindow.hide();
});

ipcMain.handle('pixelize:confirm', (_event, payload) => {
  const name = String(payload?.name || '').trim() || '新形象';
  const pixels = payload?.pixels;
  if (!Array.isArray(pixels) || pixels.length !== 64 * 64 * 4) {
    return { ok: false, error: '像素数据不对喵，重试一次吧' };
  }

  // 每个形象一个独立文件夹：sprite.png + pet.json
  const folder = `pet-${Date.now()}`;
  const dir = getPetDir(folder);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sprite.png'), encodePNG(Buffer.from(pixels), 64, 64));
    const newPet = {
      name,
      kind: 'image',
      sprite: 'sprite.png',
      size: 64,
      displayScale: petConfig.displayScale,
      animation: petConfig.animation,
      persona: petConfig.persona || DEFAULT_PET.persona, // 人设先沿用当前形象，之后可在设置里改
    };
    fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(newPet, null, 2) + '\n');
  } catch (err) {
    return { ok: false, error: `保存失败：${err.message || err}` };
  }

  // 保存即换装
  const res = switchToPet(folder);
  if (!res.ok) return res;
  if (pixelizeWindow && !pixelizeWindow.isDestroyed()) pixelizeWindow.hide();
  return { ok: true, folder };
});

// ---- AI 问答：GLM-4-Flash（OpenAI 兼容接口）----
// key 存在项目根目录的 config.local.json（已 gitignore），只在这里读，渲染进程拿不到

const CONFIG_LOCAL_PATH = path.join(__dirname, 'config.local.json');

function readLocalConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_LOCAL_PATH, 'utf8'));
  } catch {
    return {};
  }
}

ipcMain.handle('chat:ask', async (_event, messages) => {
  const cfg = readLocalConfig();
  if (!cfg.apiKey || cfg.apiKey.includes('填')) {
    return {
      ok: false,
      error:
        '还没有配置 API key 喵。\n在项目根目录创建 config.local.json（可复制 config.local.example.json），填入智谱开放平台的免费 key，再发一句话试试。',
    };
  }

  const apiBase = cfg.apiBase || 'https://open.bigmodel.cn/api/paas/v4';
  const model = cfg.model || 'glm-4-flash';

  // 等 AI 回复期间，让桌宠播放「说话」动画
  const talkTo = (on) => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:talk', on);
  };
  talkTo(true);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'system', content: petConfig.persona || DEFAULT_PET.persona }, ...messages],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    if (!res.ok) {
      const detail = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: `AI 接口返回了错误：${detail}` };
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: 'AI 返回了空回复，再问一次试试喵。' };
    return { ok: true, content };
  } catch (err) {
    const reason = err.name === 'AbortError' ? '请求超时了（30 秒）' : err.message || String(err);
    return { ok: false, error: `连不上 AI：${reason}` };
  } finally {
    talkTo(false);
  }
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
