// 开发用小工具：生成一张测试"照片"，跑一遍中位切分量化，输出前后对比图。
// 用法：node tools/quantize-test.js
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('../shared/png');
const { quantizeRGBA } = require('../shared/pixelize');

const W = 256;
const H = 256;

// 画一张有天空渐变、太阳、山丘和小房子的图，颜色足够丰富，考验量化效果
function drawTestImage() {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * W + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y < 150) {
        // 天空：从浅蓝渐变到暖白
        const t = y / 150;
        set(x, y, Math.round(120 + t * 135), Math.round(170 + t * 60), Math.round(235 - t * 20));
      } else {
        // 草地：两座深浅不同的绿色山丘
        const hill = Math.sin((x / W) * Math.PI * 2) * 20;
        const green = y < 170 + hill ? 110 : 80;
        set(x, y, 60 + (x % 7), green, 60 + (x % 5));
      }
    }
  }
  // 太阳
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - 195;
      const dy = y - 55;
      if (dx * dx + dy * dy < 900) set(x, y, 255, 200, 80);
    }
  // 小房子
  for (let y = 170; y < 230; y++)
    for (let x = 60; x < 130; x++) set(x, y, 200, 120, 90);
  for (let y = 150; y < 172; y++)
    for (let x = 50 + (y - 150); x < 140 - (y - 150); x++) set(x, y, 150, 60, 50);
  // 门
  for (let y = 195; y < 230; y++)
    for (let x = 88; x < 104; x++) set(x, y, 110, 70, 45);
  return rgba;
}

// 从 RGBA 缩到 64×64 再量化，输出成 PNG（模拟像素化管线）
function toPixel64(rgba, maxColors) {
  const small = new Uint8ClampedArray(64 * 64 * 4);
  const sx = W / 64;
  const sy = H / 64;
  // 简单的 4×4 区域平均（跟 canvas drawImage 的降采样一个思路）
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++) {
          const i = (Math.floor(y * sy + dy) * W + Math.floor(x * sx + dx)) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          n++;
        }
      const o = (y * 64 + x) * 4;
      small[o] = Math.round(r / n);
      small[o + 1] = Math.round(g / n);
      small[o + 2] = Math.round(b / n);
      small[o + 3] = 255;
    }
  }
  return quantizeRGBA(small, maxColors);
}

// 放大 4 倍方便查看
function upscale4(rgba64) {
  const out = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const s = (Math.floor(y / 4) * 64 + Math.floor(x / 4)) * 4;
      const o = (y * 256 + x) * 4;
      out[o] = rgba64[s];
      out[o + 1] = rgba64[s + 1];
      out[o + 2] = rgba64[s + 2];
      out[o + 3] = 255;
    }
  return out;
}

const src = drawTestImage();
fs.writeFileSync(path.join(__dirname, 'quant-src.png'), encodePNG(src, W, H));
fs.writeFileSync(path.join(__dirname, 'quant-16.png'), encodePNG(upscale4(toPixel64(src, 16)), W, H));
fs.writeFileSync(path.join(__dirname, 'quant-32.png'), encodePNG(upscale4(toPixel64(src, 32)), W, H));
console.log('生成 quant-src.png / quant-16.png / quant-32.png');
