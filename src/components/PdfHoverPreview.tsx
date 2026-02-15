"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TextItem = {
  str: string;
  transform: number[];
  width: number;
};

export default function PdfHoverPreview({ fileUrl }: { fileUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [numPages, setNumPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const pageLabel = useMemo(() => `${pageNumber} / ${numPages}`, [pageNumber, numPages]);

  useEffect(() => {
    let disposed = false;

    async function renderPage() {
      if (!canvasRef.current) return;

      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const loadingTask = pdfjs.getDocument(fileUrl);
      const pdf = await loadingTask.promise;

      if (disposed) return;

      setNumPages(pdf.numPages);
      const clampedPage = Math.min(Math.max(pageNumber, 1), pdf.numPages);
      if (clampedPage !== pageNumber) {
        setPageNumber(clampedPage);
        return;
      }

      const page = await pdf.getPage(clampedPage);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");

      if (!context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setCanvasSize({ width: viewport.width, height: viewport.height });

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;

      const textContent = await page.getTextContent();
      const items = (textContent.items as TextItem[]).filter((item) => typeof item?.str === "string");
      setTextItems(items);
    }

    renderPage().catch((error) => {
      console.error("PDF preview render failed", error);
      setTextItems([]);
      setCanvasSize({ width: 0, height: 0 });
    });

    return () => {
      disposed = true;
    };
  }, [fileUrl, pageNumber, scale]);

  return (
    <div className="h-full w-full flex flex-col gap-3 bg-slate-50">
      <div className="h-10 px-3 border-b border-slate-200 bg-white flex items-center justify-between text-xs text-slate-600">
        <div className="inline-flex items-center gap-2">
          <button
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="font-semibold">{pageLabel}</span>
          <button
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            disabled={pageNumber >= numPages}
            className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
          >
            Next
          </button>
        </div>

        <div className="inline-flex items-center gap-2">
          <button
            onClick={() => setScale((s) => Math.max(0.8, Number((s - 0.1).toFixed(1))))}
            className="px-2 py-1 rounded border border-slate-200"
          >
            -
          </button>
          <span className="font-semibold">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(2.4, Number((s + 0.1).toFixed(1))))}
            className="px-2 py-1 rounded border border-slate-200"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="relative mx-auto bg-white shadow-sm" style={{ width: canvasSize.width, minHeight: canvasSize.height }}>
          <canvas ref={canvasRef} className="block" />

          <div className="absolute inset-0 pointer-events-none" aria-hidden>
            {textItems.map((item, index) => {
              const x = item.transform[4] * scale;
              const y = canvasSize.height - item.transform[5] * scale;
              const fontSize = Math.max(8, Math.abs(item.transform[0]) * scale);
              const width = Math.max(1, item.width * scale);

              return (
                <span
                  key={`${item.str}-${index}`}
                  className="absolute pointer-events-auto select-text text-transparent hover:bg-yellow-300/50"
                  style={{
                    left: x,
                    top: y - fontSize,
                    fontSize,
                    width,
                    lineHeight: 1,
                    whiteSpace: "pre",
                  }}
                  title={item.str}
                >
                  {item.str}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
