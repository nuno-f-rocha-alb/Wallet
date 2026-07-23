import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdf.js runs in a web worker; the PDF never leaves the browser.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItemLike {
  str: string;
  transform: number[];
}

/** Extract a statement PDF to text, one line per visual row (items grouped by y, sorted by x). */
export async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  let text = '';
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines = new Map<number, { x: number; s: string }[]>();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const it = item as TextItemLike;
        const y = Math.round(it.transform[5]);
        (lines.get(y) ?? lines.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str });
      }
      for (const y of [...lines.keys()].sort((a, b) => b - a)) {
        text += lines.get(y)!.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ') + '\n';
      }
    }
  } finally {
    await doc.destroy(); // release the worker + buffers so repeated imports don't leak
  }
  return text;
}
