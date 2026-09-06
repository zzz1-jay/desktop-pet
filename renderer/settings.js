// 设置窗渲染进程：形象管理 + 名字 / 人设 / 显示大小，保存回当前形象的 pet.json
const nameEl = document.getElementById('name');
const personaEl = document.getElementById('persona');
const scaleEl = document.getElementById('scale');
const statusEl = document.getElementById('status');
const currentAvatarEl = document.getElementById('current-avatar');
const currentNameEl = document.getElementById('current-name');
const petListEl = document.getElementById('pet-list');

async function refreshAll() {
  const cfg = await window.settingsAPI.load();
  nameEl.value = cfg.name;
  personaEl.value = cfg.persona;
  scaleEl.value = String(cfg.displayScale);
  currentNameEl.textContent = cfg.name;
  currentAvatarEl.src = cfg.spriteDataUrl || '';

  const pets = await window.settingsAPI.listPets();
  petListEl.innerHTML = '';
  pets.forEach((pet) => {
    const item = document.createElement('button');
    item.className = 'pet-item' + (pet.active ? ' active' : '');
    item.title = pet.active ? '当前形象' : `切换到 ${pet.name}`;
    const img = document.createElement('img');
    img.src = pet.spriteDataUrl || '';
    img.alt = pet.name;
    const label = document.createElement('span');
    label.textContent = pet.name;
    item.appendChild(img);
    item.appendChild(label);

    if (pet.active) {
      const now = document.createElement('span');
      now.className = 'pet-now';
      now.textContent = '当前';
      item.appendChild(now);
    } else {
      // 非当前形象：悬停出现删除按钮，点一下变「确认」再点才真删（防手滑）
      const del = document.createElement('span');
      del.className = 'pet-del';
      del.title = `删除 ${pet.name}`;
      del.textContent = '×';
      let armed = false;
      let disarmTimer = null;
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!armed) {
          armed = true;
          del.textContent = '确认';
          del.classList.add('armed');
          disarmTimer = setTimeout(() => {
            armed = false;
            del.textContent = '×';
            del.classList.remove('armed');
          }, 4000);
          return;
        }
        clearTimeout(disarmTimer);
        const res = await window.settingsAPI.deletePet(pet.folder);
        statusEl.textContent = res.ok ? `已删除 ${pet.name} ✓` : res.error;
        refreshAll();
      });
      item.appendChild(del);

      item.addEventListener('click', async () => {
        statusEl.textContent = '切换中…';
        const res = await window.settingsAPI.switchPet(pet.folder);
        statusEl.textContent = res.ok ? `已切换到 ${pet.name} ✓` : res.error;
      });
    }
    petListEl.appendChild(item);
  });
}

refreshAll();
// 换形象 / 切换后主进程会通知刷新
window.settingsAPI.onRefresh(refreshAll);

document.getElementById('upload').addEventListener('click', () => {
  statusEl.textContent = '';
  window.settingsAPI.openUpload();
});

document.getElementById('close').addEventListener('click', () => window.settingsAPI.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.settingsAPI.close();
});

document.getElementById('save').addEventListener('click', async () => {
  statusEl.textContent = '保存中…';
  const res = await window.settingsAPI.save({
    name: nameEl.value,
    persona: personaEl.value,
    displayScale: Number(scaleEl.value),
  });
  if (res.ok) {
    statusEl.textContent = '已保存 ✓';
    await refreshAll();
    setTimeout(() => {
      statusEl.textContent = '';
    }, 1500);
  } else {
    statusEl.textContent = res.error;
  }
});
