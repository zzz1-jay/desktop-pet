// 聊天窗渲染进程：管理消息气泡和输入框；问答通过 chatAPI.ask 走主进程
// 支持粘贴截图（Ctrl+V）或拖入图片：带图消息自动走视觉模型看图说话
// 悬停气泡可单条删除（界面和对话历史同步删，AI 就不再记得这句）
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');
const attachEl = document.getElementById('attach');
const attachImgEl = document.getElementById('attach-img');
const attachRemoveEl = document.getElementById('attach-remove');

// 对话历史（发给 AI 的内容，不含系统提示词——那段由主进程统一加）
// 每条带唯一 id，和气泡上的 data-id 对应，删除时两边一起删
const history = [];
let msgSeq = 0;
const nextMsgId = () => ++msgSeq;

let pendingImage = null; // 待发送截图的 dataURL（已压缩）

function scrollToEnd() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 给气泡挂上删除按钮（欢迎语没有 id，就不带删除）
function attachDeleteButton(div, id) {
  if (!id) return;
  div.dataset.id = id;
  const del = document.createElement('button');
  del.className = 'msg-del';
  del.textContent = '×';
  del.title = '删除这条对话';
  del.addEventListener('click', () => {
    const idx = history.findIndex((m) => m.id === id);
    if (idx >= 0) history.splice(idx, 1);
    div.remove();
  });
  div.appendChild(del);
}

function addBubble(kind, text, id) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  const span = document.createElement('span');
  span.textContent = text;
  div.appendChild(span);
  attachDeleteButton(div, id);
  messagesEl.appendChild(div);
  scrollToEnd();
  return div;
}

// 用户消息带截图时：气泡里显示缩略图 + 文字
function addUserImageBubble(dataUrl, text, id) {
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
  attachDeleteButton(div, id);
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
    const id = nextMsgId();
    addUserImageBubble(pendingImage, text, id);
    history.push({
      id,
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: pendingImage } },
        { type: 'text', text: text || '请看看这张截图' },
      ],
    });
    clearPendingImage();
  } else {
    const id = nextMsgId();
    addBubble('user', text, id);
    history.push({ id, role: 'user', content: text });
  }

  const typingEl = addBubble('cat typing', '');
  for (let i = 0; i < 3; i++) typingEl.appendChild(document.createElement('span')).textContent = '●';
  setBusy(true);

  try {
    const reply = await window.chatAPI.ask(history.slice(-20));
    typingEl.remove();

    if (reply.ok) {
      const id = nextMsgId();
      history.push({ id, role: 'assistant', content: reply.content });
      addBubble('cat', reply.content, id);
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

// 当前形象的名字和头像：标题、占位符、欢迎语都用它；换形象后跟着变
function applyMeta(meta) {
  if (meta?.name) document.getElementById('chat-name').textContent = meta.name;
  if (meta?.spriteDataUrl) document.getElementById('chat-avatar').src = meta.spriteDataUrl;
  if (meta?.name) inputEl.placeholder = `跟${meta.name}说点什么…（可 Ctrl+V 粘贴截图）`;
}

// 窗口每次显示时，主进程会推当前形象信息过来（改名 / 换形象后能跟着变）
window.chatAPI.onMeta(applyMeta);

window.chatAPI.getMeta().then((meta) => {
  applyMeta(meta);
  addBubble('cat', `喵～ 我是住在你桌面上的${meta?.name || '小桌宠'}，有什么想问的尽管说！`);
});
