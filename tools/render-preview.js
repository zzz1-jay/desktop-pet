// 开发用小工具：把 cat-map 画成 PNG 预览图，方便检查猫画得可不可爱。
// 用法：node tools/render-preview.js
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('../shared/png');
const cat = require('../shared/cat-map');

const SCALE = 6; // 放大倍数，方便看清每个像素

// 背景画一层灰白棋盘格，模拟图片查看器，方便看清透明区域
function render(rows, file) {
  const n = cat.size;
  const w = n * SCALE;
  const h = n * SCALE;
  const rgba = Buffer.alloc(w * h * 4);

  const rgb = {};
  for (const [ch, hex] of Object.entries(cat.palette)) {
    rgb[ch] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[Math.floor(y / SCALE)][Math.floor(x / SCALE)];
      const i = (y * w + x) * 4;
      if (ch === '.') {
        const c = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 255 : 208;
        rgba[i] = c;
        rgba[i + 1] = c;
        rgba[i + 2] = c;
        rgba[i + 3] = 255;
      } else {
        const [r, g, b] = rgb[ch];
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
  }

  fs.writeFileSync(path.join(__dirname, file), encodePNG(rgba, w, h));
  console.log('生成', file);
}

render(cat.frames.open, 'preview-open.png');
render(cat.frames.blink, 'preview-blink.png');
render(cat.frames.talk, 'preview-talk.png');
