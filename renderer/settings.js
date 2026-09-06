// 设置窗渲染进程：读出当前形象的名字与人设，改完保存回 pet.json
const nameEl = document.getElementById('name');
const personaEl = document.getElementById('persona');
const statusEl = document.getElementById('status');

window.settingsAPI.load().then((cfg) => {
  nameEl.value = cfg.name;
  personaEl.value = cfg.persona;
});

document.getElementById('close').addEventListener('click', () => window.settingsAPI.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.settingsAPI.close();
});

document.getElementById('save').addEventListener('click', async () => {
  statusEl.textContent = '保存中…';
  const res = await window.settingsAPI.save({ name: nameEl.value, persona: personaEl.value });
  if (res.ok) {
    statusEl.textContent = '已保存 ✓';
    setTimeout(() => window.settingsAPI.close(), 600);
  } else {
    statusEl.textContent = res.error;
  }
});
