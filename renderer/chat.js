// 聊天窗渲染进程：管理消息气泡和输入框；问答通过 chatAPI.ask 走主进程
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');

// 对话历史（发给 AI 的内容，不含系统提示词——那段由主进程统一加）
const history = [];

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

// 小猫头像的欢迎语
addBubble('cat', '喵～ 我是住在你桌面上的小橘，有什么想问的尽管说！');

// ---- 发送流程 ----
let pending = false;

function setPending(on) {
  pending = on;
  inputEl.disabled = on;
  sendEl.disabled = on;
  if (!on) inputEl.focus();
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || pending) return;
  inputEl.value = '';

  addBubble('user', text);
  history.push({ role: 'user', content: text });

  const typingEl = addBubble('cat typing', '');
  for (let i = 0; i < 3; i++) typingEl.appendChild(document.createElement('span')).textContent = '●';
  setPending(true);

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
    setPending(false);
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
