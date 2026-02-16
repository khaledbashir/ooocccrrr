import { useState } from 'react';
import { UI_STATES } from '@/lib/constants';

export function usePdfExport() {
  const [isExporting, setIsExporting] = useState(false);

  const exportPdfToImages = async (file: File) => {
    if (!file) return;

    try {
      setIsExporting(true);

      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();

      const pdfData = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;
      const baseName = file.name.replace(/\.pdf$/i, '') || 'document';

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: UI_STATES.PDF_EXPORT_SCALE });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Could not create canvas context for PDF export');
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise;

        const blob: Blob = await new Promise((resolve, reject) => {
          canvas.toBlob((result) => {
            if (result) {
              resolve(result);
            } else {
              reject(new Error(`Failed to convert page ${pageNumber} to image`));
            }
          }, 'image/png');
        });

        const imageUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = `${baseName}-page-${String(pageNumber).padStart(2, '0')}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error: any) {
      console.error('PDF image export failed', error);
      alert(error?.message || 'Failed to export PDF pages as images');
    } finally {
      setIsExporting(false);
    }
  };

  return {
    isExporting,
    exportPdfToImages,
  };
}