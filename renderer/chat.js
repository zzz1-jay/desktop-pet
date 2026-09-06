// 聊天窗渲染进程：管理消息气泡和输入框；问答通过 chatAPI.ask 走主进程
// 支持粘贴截图（Ctrl+V）或拖入图片：带图消息自动走视觉模型看图说话
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');
const attachEl = document.getElementById('attach');
const attachImgEl = document.getElementById('attach-img');
const attachRemoveEl = document.getElementById('attach-remove');

// 对话历史（发给 AI 的内容，不含系统提示词——那段由主进程统一加）
const history = [];

let pendingImage = null; // 待发送截图的 dataURL（已压缩）

function scrollToEnd() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addBubble(kind, text) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToEnd();
  return div;
}

// 用户消息带截图时：气泡里显示缩略图 + 文字
function addUserImageBubble(dataUrl, text) {
  const div = document.createElement('div');
  div.className = 'msg user';
  const img = document.createElement('img');
  img.className = 'msg-img';
  img.src = dataUrl;
  div.appendChild(img);
  if (text) {
    const p = document.createElement('div');
    p.textContent = text;
    div.appendChild(p);
  }
  messagesEl.appendChild(div);
  scrollToEnd();
}

// ---- 截图：压缩到最大 800px 转 JPEG，减小请求体积 ----

function setPendingImage(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 800 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    pendingImage = c.toDataURL('image/jpeg', 0.85);
    attachImgEl.src = pendingImage;
    attachEl.hidden = false;
    inputEl.focus();
  };
  img.src = dataUrl;
}

function clearPendingImage() {
  pendingImage = null;
  attachEl.hidden = true;
  attachImgEl.src = '';
}

// Ctrl+V 粘贴截图（监听整个窗口，输入框有没有焦点都行）
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  const file = item.getAsFile();
  const reader = new FileReader();
  reader.onload = () => setPendingImage(reader.result);
  reader.readAsDataURL(file);
});

// 拖入图片文件
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setPendingImage(reader.result);
  reader.readAsDataURL(file);
});

attachRemoveEl.addEventListener('click', clearPendingImage);

// ---- 发送流程 ----
let pending = false;

function setBusy(on) {
  pending = on;
  inputEl.disabled = on;
  sendEl.disabled = on;
  if (!on) inputEl.focus();
}

async function send() {
  const text = inputEl.value.trim();
  if ((!text && !pendingImage) || pending) return;
  inputEl.value = '';

  if (pendingImage) {
    addUserImageBubble(pendingImage, text);
    history.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: pendingImage } },
        { type: 'text', text: text || '请看看这张截图' },
      ],
    });
    clearPendingImage();
  } else {
    addBubble('user', text);
    history.push({ role: 'user', content: text });
  }

  const typingEl = addBubble('cat typing', '');
  for (let i = 0; i < 3; i++) typingEl.appendChild(document.createElement('span')).textContent = '●';
  setBusy(true);

  try {
    const reply = await window.chatAPI.ask(history.slice(-20));
    typingEl.remove();

    if (reply.ok) {
      history.push({ role: 'assistant', content: reply.content });
      addBubble('cat', reply.content);
    } else {
      addBubble('error', reply.error);
    }
  } catch (err) {
    typingEl.remove();
    addBubble('error', `聊天窗出错了：${err.message || err}`);
  } finally {
    setBusy(false);
  }
}

sendEl.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  // e.isComposing：输入法选字过程中的回车不算发送
  if (e.key === 'Enter' && !e.isComposing) send();
});

// ---- 窗口控制 ----
document.getElementById('close').addEventListener('click', () => window.chatAPI.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.chatAPI.close();
});

// 当前形象的名字：标题、输入框占位符、欢迎语都用它
function applyMeta(meta) {
  if (!meta?.name) return;
  document.getElementById('chat-name').textContent = meta.name;
  inputEl.placeholder = `跟${meta.name}说点什么…（可 Ctrl+V 粘贴截图）`;
}

// 窗口每次显示时，主进程会推当前形象的名字过来（设置里改名后能跟着变）
window.chatAPI.onMeta(applyMeta);

window.chatAPI.getMeta().then((meta) => {
  applyMeta(meta);
  addBubble('cat', `喵～ 我是住在你桌面上的${meta?.name || '小桌宠'}，有什么想问的尽管说！`);
});
