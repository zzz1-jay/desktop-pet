// 桌宠渲染进程：把像素猫画到画布上
const { cat, config } = window.petAPI;

const canvas = document.getElementById('pet');
canvas.width = cat.size;
canvas.height = cat.size;
canvas.style.width = cat.size * config.displayScale + 'px';
canvas.style.height = cat.size * config.displayScale + 'px';

const ctx = canvas.getContext('2d');

// 把一套点阵（64 个字符串，每行 64 个字符）画出来
function drawFrame(rows) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      ctx.fillStyle = cat.palette[ch];
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

drawFrame(cat.frames.open);
