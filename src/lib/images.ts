/**
 * Photo handling. Phone cameras produce 4-12 MP JPEGs; storing those verbatim
 * would bloat IndexedDB and the generated Word file, so every picked photo is
 * re-encoded to a bounded JPEG before it is ever saved.
 */

/** Longest edge of a stored photo, in pixels. Plenty for an A4 print. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * A picked file, decoded, whatever it took.
 *
 * `createImageBitmap` is the fast path and the right one, but it refuses
 * formats the browser itself can display — an iPhone photograph kept as HEIC is
 * the one that matters here, and on a phone set to "Keep Original" that is
 * every photograph. It used to throw, and the photo was simply not added.
 * Safari will decode anything the system can through an `<img>`, so that is the
 * second attempt.
 */
async function decodeImage(file: File | Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('לא ניתן לפענח את התמונה'));
        img.src = url;
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url);
      throw new Error('לא ניתן לפענח את התמונה');
    }
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  }
}

/** Downscale + re-encode a picked file to a bounded JPEG. */
export async function prepareImage(file: File | Blob): Promise<PreparedImage> {
  const bitmap = await decodeImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('לא ניתן לעבד את התמונה');
  ctx.drawImage(bitmap.source, 0, 0, width, height);
  bitmap.release();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('לא ניתן לעבד את התמונה');
  return { blob, width, height };
}

/**
 * Company logo for the report header. Kept as PNG so transparency survives, and
 * bounded to a size that stays crisp in print without bloating every export.
 */
export async function prepareLogo(file: File | Blob): Promise<PreparedImage> {
  const bitmap = await decodeImage(file);
  const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('לא ניתן לעבד את הלוגו');
  ctx.drawImage(bitmap.source, 0, 0, width, height);
  bitmap.release();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('לא ניתן לעבד את הלוגו');
  return { blob, width, height };
}

/**
 * A photographed or scanned signature, made fit to sit on the form.
 *
 * The paper it was signed on becomes transparent. Without this, a signature
 * uploaded as a photo prints as a white rectangle that covers the ruled line
 * underneath it — recognisably a pasted-in picture rather than a signature.
 * The threshold is deliberately forgiving, because paper photographed indoors
 * is never actually white.
 */
const PAPER_THRESHOLD = 210;

export async function prepareSignature(file: File | Blob): Promise<PreparedImage> {
  const bitmap = await decodeImage(file);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('לא ניתן לעבד את החתימה');
  ctx.drawImage(bitmap.source, 0, 0, width, height);
  bitmap.release();

  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const lightest = Math.max(data[i], data[i + 1], data[i + 2]);
    if (lightest >= PAPER_THRESHOLD) {
      data[i + 3] = 0;
    } else {
      // Ink darkens towards the middle of a stroke; fading the edges in step
      // with their lightness keeps the stroke smooth instead of jagged.
      data[i + 3] = Math.min(255, Math.round(((PAPER_THRESHOLD - lightest) / PAPER_THRESHOLD) * 400));
    }
  }
  ctx.putImageData(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('לא ניתן לעבד את החתימה');
  return { blob, width, height };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** `data:image/png;base64,AAA` -> `AAA`, as docx's ImageRun expects. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/** Human readable size, e.g. `1.4 MB`. Device quotas reach gigabytes. */
export function formatBytes(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}
