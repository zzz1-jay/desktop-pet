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

module.exports = { quantizeRGBA };
