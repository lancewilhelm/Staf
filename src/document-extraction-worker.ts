import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function extract() {
  const data = new Uint8Array(workerData);
  const task = getDocument({data, stopAtErrors:true, useWasm:false, verbosity:0});
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 200) throw Error('PDF exceeds 200 pages');
    const pages: string[] = [];
    let total = 0;
    for (let n=1; n<=pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str + (item.hasEOL ? '\n' : ' ');
          if (total + text.length > 1_000_000) throw Error('Extracted text exceeds 1000000 characters');
        }
      }
      total += text.length;
      pages.push(text);
      page.cleanup();
    }
    if (!pages.some(page => page.trim())) throw Error('PDF has no readable text layer');
    return pages;
  } finally { await task.destroy(); }
}
try { parentPort?.postMessage({pages:await extract()}); }
catch (error) { const message = error instanceof Error ? error.message : 'Unreadable PDF'; parentPort?.postMessage({error:/password/i.test(message) ? 'Encrypted PDFs are not supported' : message}); }
