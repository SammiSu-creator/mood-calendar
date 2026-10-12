/**
 * 图片处理：把用户选的原图压成两份
 *   thumb 240px / q0.70 —— 网格圆圈用，约 15KB
 *   full  1400px / q0.78 —— 详情页用，约 250KB
 *
 * 关键点：
 * 1. createImageBitmap 读取 EXIF 方向，手机横竖拍不会躺倒
 * 2. 缩放用 canvas，保持比例
 * 3. Blob URL 用完必须 revoke，否则内存泄漏
 */

const THUMB_SIZE = 240;
const THUMB_QUALITY = 0.7;
const FULL_SIZE = 1400;
const FULL_QUALITY = 0.78;

/**
 * 把 Blob 变成 <img>，并在解码完成后自动释放 object URL。
 *
 * 注意：不能像以前那样用 setTimeout(0) 立即 revoke——
 * 浏览器解码图片是异步的，URL 提前失效会显示裂图。
 * 必须挂在 img.onload / onerror 上释放。
 *
 * @returns {HTMLImageElement} 已 append 到 container 的 img
 */
export function blobImage(blob, container, { alt = '', onReady = null } = {}) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.alt = alt;
  img.decoding = 'async';

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    URL.revokeObjectURL(url);
  };

  img.addEventListener('load', () => {
    release();
    if (onReady) onReady(img);
  });
  img.addEventListener('error', () => {
    release();
    // 解码失败要退化成 emoji 占位，而不是留一个裂图
    if (img.parentNode) img.remove();
    if (onReady) onReady(null);
  });

  img.src = url;
  if (container) container.prepend ? container.prepend(img) : container.appendChild(img);
  return img;
}

/** 读取文件为 ImageBitmap，自动纠正 EXIF 方向 */
async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      // imageOrientation: 'from-image' 会应用 EXIF 旋转
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 老浏览器或格式不支持，走下面的兜底 */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，换一张试试'));
    };
    img.src = url;
  });
}

/** 按最长边等比缩放并导出 Blob */
function scale(source, maxSide, quality) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  if (!sw || !sh) throw new Error('图片尺寸异常');

  const ratio = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * ratio));
  const h = Math.max(1, Math.round(sh * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      'image/jpeg', // 一律转 jpeg，兼容性最好
      quality
    );
  });
}

/**
 * 处理用户选的文件
 * @returns {{thumb: Blob, full: Blob, width:number, height:number}}
 */
export async function processImage(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  // 超过 25MB 的原图直接拒绝，避免手机内存被撑爆
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('图片太大了（>25MB），换一张小一点的');
  }

  const bitmap = await loadBitmap(file);
  try {
    // 尺寸必须在 close() 之前读。ImageBitmap.close() 之后
    // 按规范 width/height 会归零，先关再读只会拿到 0×0。
    const width = bitmap.width;
    const height = bitmap.height;
    const [thumb, full] = await Promise.all([
      scale(bitmap, THUMB_SIZE, THUMB_QUALITY),
      scale(bitmap, FULL_SIZE, FULL_QUALITY),
    ]);
    if (bitmap.close) bitmap.close();
    return { thumb, full, width, height };
  } catch (e) {
    if (bitmap.close) bitmap.close();
    throw e;
  }
}

/** 导出备份用：Blob → base64 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 导入备份用：base64 → Blob */
export function base64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** 取图片主色调，用于没有照片的日子也能有颜色 */
export function dominantColor(bitmap) {
  try {
    const w = 8;
    const h = 8;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    if (!n) return null;
    // 稍微提亮一点，颜色更柔和
    r = Math.round((r / n) * 0.85 + 38);
    g = Math.round((g / n) * 0.85 + 38);
    b = Math.round((b / n) * 0.85 + 38);
    return `rgb(${r},${g},${b})`;
  } catch {
    return null;
  }
}