// 默认形象：用代码逐格画出来的像素橘猫（64×64）。
//
// 画法分三步：
//   1. 用椭圆 / 三角形铺出身体、头、耳朵、肚皮、爪子的大形
//      （左右对称的部分只画左半边，然后镜像到右边，保证严格对称）
//   2. 补上眼睛、鼻子、嘴巴、条纹、尾巴这些细节
//   3. 沿轮廓自动描一圈深色边
//
// 睁眼 / 闭眼两套点阵都从这里生成，眨眼动画就是两套点阵来回切。

const SIZE = 64;

// 调色板：字符 → 颜色。'.' 表示透明。
const PALETTE = {
  K: '#4a2e1e', // 描边（暖深棕）
  O: '#f5a860', // 身体橘色
  D: '#d8823c', // 条纹深橘
  W: '#fff4e1', // 奶油白（肚皮 / 口鼻 / 爪子）
  P: '#f09b9b', // 粉色（耳朵内 / 鼻子）
  E: '#3b2314', // 眼睛
  H: '#ffffff', // 眼睛高光
};

function newGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill('.'));
}

function inside(x, y) {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}

// ---- 小绘图工具箱 ------------------------------------------------------

// 填充椭圆。cx/cy 是圆心坐标；opt.onlyOver 限定只能画在某些颜色上，
// opt.onlyIfEmpty 表示只画空白处（比如藏在身体后面的尾巴）。
function fillEllipse(g, cx, cy, rx, ry, ch, opt = {}) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (!inside(x, y)) continue;
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      if (opt.onlyOver && !opt.onlyOver.includes(g[y][x])) continue;
      if (opt.onlyIfEmpty && g[y][x] !== '.') continue;
      g[y][x] = ch;
    }
  }
}

function fillRect(g, x, y, w, h, ch, opt = {}) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (!inside(i, j)) continue;
      if (opt.onlyOver && !opt.onlyOver.includes(g[j][i])) continue;
      g[j][i] = ch;
    }
  }
}

// 填充三角形（a/b/c 是顶点 [x, y]，用叉积判断点在不在三角形内）
function fillTriangle(g, a, b, c, ch, opt = {}) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const minX = Math.min(a[0], b[0], c[0]);
  const minY = Math.min(a[1], b[1], c[1]);
  const maxX = Math.max(a[0], b[0], c[0]);
  const maxY = Math.max(a[1], b[1], c[1]);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!inside(x, y)) continue;
      const p = [x + 0.5, y + 0.5];
      const d1 = sign(p, a, b);
      const d2 = sign(p, b, c);
      const d3 = sign(p, c, a);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      if (hasNeg && hasPos) continue;
      if (opt.onlyOver && !opt.onlyOver.includes(g[y][x])) continue;
      g[y][x] = ch;
    }
  }
}

// 把左半边（x < 32）镜像到右半边
function mirror(g) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE / 2; x++) {
      g[y][SIZE - 1 - x] = g[y][x];
    }
  }
}

// 自动描边：紧挨着实心区域的空白像素涂成描边色
function outline(g) {
  const snap = g.map((r) => r.slice());
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (snap[y][x] !== '.') continue;
      const touches = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => inside(x + dx, y + dy) && snap[y + dy][x + dx] !== '.');
      if (touches) g[y][x] = 'K';
    }
  }
  return g;
}

// ---- 画猫 --------------------------------------------------------------

// 画除眼睛外的所有部分（睁眼 / 闭眼都要用到这份底图）
function buildBase() {
  const g = newGrid();

  // 身体和头（圆心都在画布中轴 x=32 上，天然左右对称）
  fillEllipse(g, 32, 48, 14, 13, 'O'); // 坐着的身体
  fillEllipse(g, 32, 23, 17, 14, 'O'); // 大脑袋

  // 左耳（外圈橘色 + 内圈粉色），镜像后得到右耳
  fillTriangle(g, [15, 3], [8, 16], [25, 13], 'O');
  fillTriangle(g, [15, 6], [11, 14], [21, 12], 'P');

  // 脸颊两侧的条纹（只画在橘色上，超出脸范围的部分自动被裁掉）
  fillRect(g, 15, 21, 4, 2, 'D', { onlyOver: ['O'] });
  fillRect(g, 14, 25, 4, 2, 'D', { onlyOver: ['O'] });

  // 身体两侧的条纹
  fillRect(g, 19, 41, 4, 2, 'D', { onlyOver: ['O'] });
  fillRect(g, 18, 46, 4, 2, 'D', { onlyOver: ['O'] });

  mirror(g);

  // 尾巴：一串圆从身体右后方翘起来（只画空白处，所以根部藏在身体后面）
  const tail = [
    [44, 53],
    [48, 56],
    [52, 54],
    [55, 50],
    [56, 46],
  ];
  tail.forEach(([x, y]) => fillEllipse(g, x, y, 3, 3, 'O', { onlyIfEmpty: true }));
  // 尾巴尖和一圈深色环
  fillEllipse(g, 56, 46, 2.6, 2.6, 'D', { onlyOver: ['O'] });
  fillEllipse(g, 52.5, 53.5, 2.2, 2.2, 'D', { onlyOver: ['O'] });

  // 白肚皮和口鼻
  fillEllipse(g, 32, 49, 9, 9, 'W');
  fillEllipse(g, 32, 30.5, 7, 4.5, 'W');

  // 鼻子（粉色小三角）和 ω 形嘴
  fillRect(g, 30, 27, 4, 1, 'P');
  fillRect(g, 31, 28, 2, 1, 'P');
  fillRect(g, 31, 29, 2, 1, 'E');
  fillRect(g, 29, 30, 2, 1, 'E');
  fillRect(g, 33, 30, 2, 1, 'E');

  // 头顶三道条纹（经典的橘猫 "M" 额头纹）
  fillRect(g, 31, 10, 2, 7, 'D', { onlyOver: ['O'] });
  fillRect(g, 27, 11, 2, 6, 'D', { onlyOver: ['O'] });
  fillRect(g, 35, 11, 2, 6, 'D', { onlyOver: ['O'] });

  // 两只前爪（白色小椭圆，中间留一道缝）
  fillEllipse(g, 26.5, 57.5, 4.25, 3.5, 'W');
  fillEllipse(g, 36.5, 57.5, 4.25, 3.5, 'W');
  fillRect(g, 31, 54, 2, 7, 'O'); // 爪子之间的缝（露出身体的橘色）

  return g;
}

// 睁眼版：黑亮的大眼睛 + 左上角高光
function withOpenEyes(base) {
  const g = base.map((r) => r.slice());
  fillEllipse(g, 24.5, 22, 3, 4, 'E');
  fillEllipse(g, 38.5, 22, 3, 4, 'E');
  fillRect(g, 23, 19, 2, 2, 'H');
  fillRect(g, 39, 19, 2, 2, 'H');
  return g;
}

// 闭眼版：两条向下弯的小弧线
function withClosedEyes(base) {
  const g = base.map((r) => r.slice());
  fillRect(g, 22, 21, 6, 1, 'E');
  fillRect(g, 23, 22, 4, 1, 'E');
  fillRect(g, 36, 21, 6, 1, 'E');
  fillRect(g, 37, 22, 4, 1, 'E');
  return g;
}

const base = buildBase();
const toRows = (g) => g.map((r) => r.join(''));

module.exports = {
  size: SIZE,
  palette: PALETTE,
  frames: {
    open: toRows(outline(withOpenEyes(base))),
    blink: toRows(outline(withClosedEyes(base))),
  },
};
