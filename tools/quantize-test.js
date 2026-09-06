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

// ---- 全身像素小人管线验证：纯色背景 + 站立小人 → 抠背景 → 裁剪 → 缩放 → 量化 ----
const { removeBackground, cropRGBA, fitToSprite } = require('../shared/pixelize');

function drawPerson() {
  const w = 400;
  const h = 500;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * w + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  };
  const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  // 纯色浅灰背景
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 225, 230, 238);
  // 头
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inEllipse(x, y, 200, 105, 52, 60)) set(x, y, 245, 210, 175);
  // 头发
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inEllipse(x, y, 200, 78, 58, 48) && y < 105) set(x, y, 70, 45, 30);
  // 眼睛
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (inEllipse(x, y, 180, 112, 7, 9)) set(x, y, 50, 35, 25);
    if (inEllipse(x, y, 220, 112, 7, 9)) set(x, y, 50, 35, 25);
  }
  // 身体（蓝色上衣）
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inEllipse(x, y, 200, 300, 85, 130) && y > 155) set(x, y, 80, 130, 200);
  // 手
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (inEllipse(x, y, 122, 300, 16, 16)) set(x, y, 245, 210, 175);
    if (inEllipse(x, y, 278, 300, 16, 16)) set(x, y, 245, 210, 175);
  }
  // 裤子
  for (let y = 380; y < h - 10; y++) for (let x = 0; x < w; x++) if (Math.abs(x - 178) < 28 || Math.abs(x - 222) < 28) set(x, y, 70, 80, 110);
  // 鞋
  for (let y = h - 30; y < h - 8; y++) for (let x = 0; x < w; x++) {
    if (Math.abs(x - 178) < 34 || Math.abs(x - 222) < 34) set(x, y, 40, 40, 45);
  }
  return { rgba, w, h };
}

const person = drawPerson();
fs.writeFileSync(path.join(__dirname, 'person-src.png'), encodePNG(person.rgba, person.w, person.h));

// 管线：抠背景 → 裁掉多余背景 → 缩进 64×64 → 32 色量化
const bgRemoved = removeBackground(person.rgba, person.w, person.h, 28);
const cropped = cropRGBA(bgRemoved, person.w, person.h, 95, 30, 210, 460);
const fitted = fitToSprite(cropped, 210, 460, 64);
const quantized = quantizeRGBA(fitted, 32);

// 铺在棋盘格上输出，直观检查透明区域
function overChecker(rgba64, scale) {
  const size = 64 * scale;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 255 : 205;
      const o = (y * size + x) * 4;
      out[o] = c;
      out[o + 1] = c;
      out[o + 2] = c;
      out[o + 3] = 255;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const s = (Math.floor(y / scale) * 64 + Math.floor(x / scale)) * 4;
      const a = rgba64[s + 3] / 255;
      const o = (y * size + x) * 4;
      out[o] = out[o] * (1 - a) + rgba64[s] * a;
      out[o + 1] = out[o + 1] * (1 - a) + rgba64[s + 1] * a;
      out[o + 2] = out[o + 2] * (1 - a) + rgba64[s + 2] * a;
      out[o + 3] = 255;
    }
  return out;
}

fs.writeFileSync(path.join(__dirname, 'person-pixel.png'), encodePNG(overChecker(quantized, 5), 320, 320));
console.log('生成 person-src.png（原图）/ person-pixel.png（抠背景像素小人，棋盘格=透明）');
