import Tesseract from 'tesseract.js';

export interface OcrResult {
  text: string;
  dataUrl: string; // downscaled JPEG, used for preview + upload
  mime: 'image/jpeg';
}

// Cap the longest side: a smaller image OCRs faster and stores smaller. Phone photos are
// huge; ~1600px is plenty for receipt text.
async function downscale(file: File, max = 1600): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}

// Self-hosted Tesseract runtime (see scripts/fetch-ocr-assets.mjs). Pointing these at our own
// origin keeps OCR fully on-device — no CDN fetch — and lets the CSP stay `self`-only.
const OCR_ASSETS = {
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/',
  langPath: '/tesseract/lang',
  // Models are vendored uncompressed (official tessdata_fast), so don't look for `.gz`.
  gzip: false,
  // Load the worker directly from our origin instead of wrapping it in a blob: URL.
  workerBlobURL: false,
} as const;

/** Image → OCR text, fully on-device (assets served from this origin, nothing leaves). */
export async function imageToText(file: File, onProgress?: (p: number) => void): Promise<OcrResult> {
  const dataUrl = await downscale(file);
  const { data } = await Tesseract.recognize(dataUrl, 'por+eng', {
    ...OCR_ASSETS,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  return { text: data.text, dataUrl, mime: 'image/jpeg' };
}

/** Strip the "data:...;base64," prefix, leaving raw base64 for the API. */
export const dataUrlToBase64 = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1);
