// 中位切分色彩量化：把一张图的颜色收敛到有限调色板（"像素味"的关键一步）。
// 算法：把所有出现的颜色按像素数分桶 → 反复沿颜色范围最大的轴、按中位数切分，
//      直到桶数达到上限 → 每个桶的加权平均色作为调色板 → 全图像素映射到最近的调色板色。
// 输入输出都是 RGBA 的 Uint8ClampedArray，纯函数，主进程 / 渲染进程 / Node 都能用。

// 取 key 的某个颜色通道（0=r, 1=g, 2=b）
function channelOf(key, c) {
  return (key >> (16 - c * 8)) & 0xff;
}

function quantizeRGBA(rgba, maxColors) {
  const out = new Uint8ClampedArray(rgba.length);

  // 1. 统计每种颜色出现的像素数（半透明以下按透明处理，保留透明区域）
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) {
      out[i + 3] = 0;
      continue;
    }
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return out;

  // 颜色数没超上限就不用量化，原样返回
  if (counts.size <= maxColors) {
    out.set(rgba);
    return out;
  }

  // 2. 中位切分
  let totalOpaque = 0;
  for (const n of counts.values()) totalOpaque += n;
  let buckets = [{ colors: [...counts.keys()], total: totalOpaque }];
  while (buckets.length < maxColors) {
    // 找像素数最多的可切分桶（至少两种颜色才能切）
    let target = -1;
    let targetCount = 0;
    buckets.forEach((b, idx) => {
      if (b.colors.length >= 2 && b.total > targetCount) {
        targetCount = b.total;
        target = idx;
      }
    });
    if (target < 0) break; // 全是不可再分的单色桶了

    const bucket = buckets[target];

    // 找桶内颜色范围最大的通道
    let axis = 0;
    let bestRange = -1;
    for (let c = 0; c < 3; c++) {
      let min = 255;
      let max = 0;
      for (const key of bucket.colors) {
        const v = channelOf(key, c);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min > bestRange) {
        bestRange = max - min;
        axis = c;
      }
    }
    if (bestRange <= 0) break;

    bucket.colors.sort((a, b) => channelOf(a, axis) - channelOf(b, axis));

    // 按像素数加权的中位数找切分点，保证两边都非空
    const half = bucket.total / 2;
    let acc = 0;
    let cut = 0;
    for (; cut < bucket.colors.length - 1; cut++) {
      acc += counts.get(bucket.colors[cut]);
      if (acc >= half) {
        cut++;
        break;
      }
    }
    const colorsA = bucket.colors.slice(0, cut);
    const colorsB = bucket.colors.slice(cut);
    const totalA = colorsA.reduce((s, k) => s + counts.get(k), 0);
    const totalB = bucket.total - totalA;
    buckets.splice(target, 1, { colors: colorsA, total: totalA }, { colors: colorsB, total: totalB });
  }

  // 3. 每个桶的加权平均色 = 调色板
  const palette = buckets.map((b) => {
    let total = 0;
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const key of b.colors) {
      const n = counts.get(key);
      total += n;
      r += channelOf(key, 0) * n;
      g += channelOf(key, 1) * n;
      bl += channelOf(key, 2) * n;
    }
    return [Math.round(r / total), Math.round(g / total), Math.round(bl / total)];
  });

  // 4. 每个像素映射到最近的调色板色（同色只算一次）
  const cache = new Map();
  const nearestIndex = (key) => {
    if (cache.has(key)) return cache.get(key);
    const r = channelOf(key, 0);
    const g = channelOf(key, 1);
    const b = channelOf(key, 2);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i];
      const d = (pr - r) * (pr - r) + (pg - g) * (pg - g) + (pb - b) * (pb - b);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };

  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue; // 透明保持透明（out 已清零）
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    const [r, g, b] = palette[nearestIndex(key)];
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  return out;
}

// ---- 抠背景 / 裁剪 / 缩放（全身像素小人的三件套） ----

// 容差抠背景：取四角平均色当背景色，从图片四边出发，
// 把「与背景色足够接近」的连通区域全部变透明。
// 复杂背景会有残留，可以在像素编辑器里手动擦（阶段 4）。
function removeBackground(rgba, w, h, tolerance) {
  const out = new Uint8ClampedArray(rgba);
  if (w < 2 || h < 2 || tolerance <= 0) return out;

  // 背景色：四个角各取 8×8 区域的平均
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const corner = (cx, cy) => {
    for (let y = cy; y < Math.min(cy + 8, h); y++)
      for (let x = cx; x < Math.min(cx + 8, w); x++) {
        const i = (y * w + x) * 4;
        r += rgba[i];
        g += rgba[i + 1];
        b += rgba[i + 2];
        n++;
      }
  };
  corner(0, 0);
  corner(w - 8, 0);
  corner(0, h - 8);
  corner(w - 8, h - 8);
  const bgR = r / n;
  const bgG = g / n;
  const bgB = b / n;

  const limit = tolerance * tolerance * 3; // 三通道平均差 ≤ tolerance
  const near = (i) => {
    const dr = rgba[i] - bgR;
    const dg = rgba[i + 1] - bgG;
    const db = rgba[i + 2] - bgB;
    return dr * dr + dg * dg + db * db <= limit;
  };

  // 从四边种子点开始 BFS，只扩散到「接近背景色」的连通像素
  const visited = new Uint8Array(w * h);
  const queue = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (visited[p]) return;
    const i = p * 4;
    if (!near(i)) return;
    visited[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (queue.length) {
    const p = queue.pop();
    out[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return out;
}

// 裁剪出 {x, y, w, h} 区域
function cropRGBA(rgba, w, h, x, y, cw, ch) {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let j = 0; j < ch; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= h) continue;
    for (let i = 0; i < cw; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= w) continue;
      const s = (sy * w + sx) * 4;
      const o = (j * cw + i) * 4;
      out[o] = rgba[s];
      out[o + 1] = rgba[s + 1];
      out[o + 2] = rgba[s + 2];
      out[o + 3] = rgba[s + 3];
    }
  }
  return out;
}

// 等比缩放到 targetSize×targetSize 内并居中（长边贴边）。
// 缩小时做「透明感知」的区域平均：透明像素不参与颜色平均，
// 避免背景色在人物边缘渗出白边 / 黑边。
function fitToSprite(rgba, w, h, targetSize) {
  const out = new Uint8ClampedArray(targetSize * targetSize * 4);
  const scale = Math.min(targetSize / w, targetSize / h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const offX = Math.floor((targetSize - dw) / 2);
  const offY = Math.floor((targetSize - dh) / 2);

  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor(dy / scale);
    const sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) / scale));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor(dx / scale);
      const sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) / scale));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < Math.min(sy1, h); sy++)
        for (let sx = sx0; sx < Math.min(sx1, w); sx++) {
          const i = (sy * w + sx) * 4;
          const alpha = rgba[i + 3] / 255;
          r += rgba[i] * alpha;
          g += rgba[i + 1] * alpha;
          b += rgba[i + 2] * alpha;
          a += alpha;
          n++;
        }
      const o = ((dy + offY) * targetSize + (dx + offX)) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
        out[o + 3] = (a / n) * 255;
      }
    }
  }
  return out;
}

module.exports = { quantizeRGBA, removeBackground, cropRGBA, fitToSprite };
