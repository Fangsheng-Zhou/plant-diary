// Turns a picked photo into two small JPEGs: a thumbnail for lists and a
// full-size version (longest side 1600 px). Keeps storage use low.

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo could not be opened. Try a JPEG or PNG.'));
    };
    img.src = url;
  });
}

function toJpeg(img, maxSide, quality) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Could not process this photo.'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', quality);
  });
}

export async function preparePhoto(file) {
  const { img, url } = await loadImage(file);
  try {
    const full = await toJpeg(img, 1600, 0.8);
    const thumb = await toJpeg(img, 480, 0.75);
    return { full, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Re-create a thumbnail from full-size JPEG bytes (used when restoring a backup). */
export async function thumbFromJpeg(bytes) {
  const file = new Blob([bytes], { type: 'image/jpeg' });
  const { img, url } = await loadImage(file);
  try {
    return await toJpeg(img, 480, 0.75);
  } finally {
    URL.revokeObjectURL(url);
  }
}
