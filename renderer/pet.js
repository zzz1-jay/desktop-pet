// 桌宠渲染进程：M1-1 先画一个占位色块验证窗口，M1-2 换成真正的像素猫
const canvas = document.getElementById('pet');
const ctx = canvas.getContext('2d');

// 显示尺寸 = 素材 64 × 3 倍
canvas.style.width = '192px';
canvas.style.height = '192px';

ctx.fillStyle = '#f5a860';
ctx.fillRect(8, 8, 48, 48);
