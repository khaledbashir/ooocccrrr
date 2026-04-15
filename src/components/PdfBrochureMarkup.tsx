"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Link2, Trash2, Upload } from "lucide-react";

import type { StructuredDisplay } from "@/lib/displayExtractor";
import type { ProposalBrochureAttachment } from "@/types";

type Props = {
  brochures: ProposalBrochureAttachment[];
  displays: StructuredDisplay[];
  selectedBrochureId: string | null;
  selectedDisplayId: string | null;
  onSelectBrochure: (brochureId: string) => void;
  onSelectDisplay: (displayId: string) => void;
  onAssignPage: (displayId: string, brochureId: string, pageNumber: number) => void;
  onClearDisplayLink: (displayId: string) => void;
  onRemoveBrochure: (brochureId: string) => void;
  onUploadClick: () => void;
};

type PageBadge = {
  displayId: string;
  displayName: string;
};

export default function PdfBrochureMarkup({
  brochures,
  displays,
  selectedBrochureId,
  selectedDisplayId,
  onSelectBrochure,
  onSelectDisplay,
  onAssignPage,
  onClearDisplayLink,
  onRemoveBrochure,
  onUploadClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const selectedBrochure = useMemo(
    () => brochures.find((brochure) => brochure.id === selectedBrochureId) || brochures[0] || null,
    [brochures, selectedBrochureId],
  );
  const selectedDisplay =
    displays.find((display) => display.id === selectedDisplayId) ||
    displays.find((display) => !display.brochureRef) ||
    displays[0] ||
    null;

  const pageAssignments = useMemo(() => {
    if (!selectedBrochure) return new Map<number, PageBadge[]>();

    return displays.reduce((map, display) => {
      if (display.brochureRef?.brochureId !== selectedBrochure.id) return map;
      const existing = map.get(display.brochureRef.pageNumber) || [];
      existing.push({ displayId: display.id, displayName: display.name });
      map.set(display.brochureRef.pageNumber, existing);
      return map;
    }, new Map<number, PageBadge[]>());
  }, [displays, selectedBrochure]);

  useEffect(() => {
    if (selectedBrochure && selectedBrochure.id !== selectedBrochureId) {
      onSelectBrochure(selectedBrochure.id);
    }
  }, [onSelectBrochure, selectedBrochure, selectedBrochureId]);

  useEffect(() => {
    if (selectedDisplay && selectedDisplay.id !== selectedDisplayId) {
      onSelectDisplay(selectedDisplay.id);
    }
  }, [onSelectDisplay, selectedDisplay, selectedDisplayId]);

  useEffect(() => {
    setPageNumber(1);
    setNumPages(1);
    setRenderError(null);
  }, [selectedBrochure?.id]);

  useEffect(() => {
    let disposed = false;

    async function renderPage() {
      if (!selectedBrochure?.url || !canvasRef.current) return;

      setIsRendering(true);
      setRenderError(null);

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const loadingTask = pdfjs.getDocument(selectedBrochure.url);
        const pdf = await loadingTask.promise;

        if (disposed) return;

        setNumPages(pdf.numPages);
        const safePageNumber = Math.min(Math.max(pageNumber, 1), pdf.numPages);
        if (safePageNumber !== pageNumber) {
          setPageNumber(safePageNumber);
          return;
        }

        const page = await pdf.getPage(safePageNumber);
        const viewport = page.getViewport({ scale: 1.1 });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Canvas context unavailable");
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setCanvasSize({ width: viewport.width, height: viewport.height });

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise;
      } catch (error) {
        console.error("Brochure PDF render failed", error);
        if (!disposed) {
          setRenderError(error instanceof Error ? error.message : "Failed to render brochure page");
          setCanvasSize({ width: 0, height: 0 });
        }
      } finally {
        if (!disposed) {
          setIsRendering(false);
        }
      }
    }

    void renderPage();

    return () => {
      disposed = true;
    };
  }, [pageNumber, selectedBrochure]);

  const currentPageAssignments = pageAssignments.get(pageNumber) || [];

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">PDF Brochure Markup</p>
          <p className="mt-1 text-xs text-slate-500">
            Attach product brochures, browse pages, and save the matching page for each screen.
          </p>
        </div>
        <button
          type="button"
          onClick={onUploadClick}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          <Upload size={14} />
          Add Brochure PDFs
        </button>
      </div>

      {brochures.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">No brochures attached yet</p>
          <p className="mt-1 text-xs text-slate-500">Upload one or more product PDFs to start tagging pages to displays.</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Brochures</p>
              <div className="mt-2 space-y-2">
                {brochures.map((brochure) => {
                  const taggedCount = displays.filter((display) => display.brochureRef?.brochureId === brochure.id).length;
                  const isActive = brochure.id === selectedBrochure?.id;

                  return (
                    <div
                      key={brochure.id}
                      className={`rounded-lg border px-3 py-2 ${
                        isActive ? "border-indigo-300 bg-white shadow-sm" : "border-slate-200 bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectBrochure(brochure.id)}
                        className="w-full text-left"
                      >
                        <p className="truncate text-sm font-semibold text-slate-800">{brochure.name}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {taggedCount} screen{taggedCount === 1 ? "" : "s"} linked
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveBrochure(brochure.id)}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700"
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Screens</p>
              <div className="mt-2 max-h-96 space-y-2 overflow-auto">
                {displays.map((display) => {
                  const isActive = display.id === selectedDisplay?.id;
                  return (
                    <button
                      key={display.id}
                      type="button"
                      onClick={() => onSelectDisplay(display.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left ${
                        isActive ? "border-indigo-300 bg-white shadow-sm" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{display.name}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {display.location} • Qty {display.quantity} • {display.sqFt.toFixed(2)} sq ft
                          </p>
                        </div>
                        {display.brochureRef ? <CheckCircle2 size={16} className="shrink-0 text-emerald-600" /> : null}
                      </div>
                      {display.brochureRef ? (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                          <span className="truncate">
                            {display.brochureRef.brochureName} • Page {display.brochureRef.pageNumber}
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onClearDisplayLink(display.id);
                            }}
                            className="font-semibold text-rose-600 hover:text-rose-700"
                          >
                            Clear
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] text-slate-400">No brochure page linked yet</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            {selectedBrochure ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{selectedBrochure.name}</p>
                    <p className="mt-1 text-[11px] text-slate-500">Navigate pages, then assign the current page to the active screen.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
                      disabled={pageNumber <= 1}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="min-w-20 text-center text-xs font-semibold text-slate-700">
                      Page {pageNumber} / {numPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPageNumber((current) => Math.min(numPages, current + 1))}
                      disabled={pageNumber >= numPages}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Active Screen</p>
                    <p className="mt-1 text-sm font-semibold text-indigo-950">{selectedDisplay?.name || "Select a screen"}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedDisplay}
                    onClick={() => {
                      if (!selectedDisplay || !selectedBrochure) return;
                      onAssignPage(selectedDisplay.id, selectedBrochure.id, pageNumber);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Link2 size={14} />
                    Tag This Page
                  </button>
                </div>

                <div className="mt-3 overflow-auto rounded-xl border border-slate-200 bg-white p-3">
                  {renderError ? (
                    <div className="flex min-h-72 items-center justify-center text-center">
                      <div>
                        <p className="text-sm font-semibold text-rose-700">Preview failed</p>
                        <p className="mt-1 text-xs text-rose-600">{renderError}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="relative mx-auto" style={{ width: canvasSize.width || undefined }}>
                      <canvas ref={canvasRef} className="mx-auto block max-w-full shadow-sm" />
                      {currentPageAssignments.length > 0 ? (
                        <div className="absolute right-3 top-3 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                          {currentPageAssignments.length} linked
                        </div>
                      ) : null}
                      {isRendering ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-semibold text-slate-600">
                          Rendering page...
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Page Markers</p>
                    {Array.from(pageAssignments.entries()).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Array.from(pageAssignments.entries())
                          .sort((a, b) => a[0] - b[0])
                          .map(([assignedPageNumber, assignments]) => (
                            <button
                              key={assignedPageNumber}
                              type="button"
                              onClick={() => setPageNumber(assignedPageNumber)}
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                                assignedPageNumber === pageNumber
                                  ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                                  : "border-slate-200 bg-slate-50 text-slate-700"
                              }`}
                            >
                              Page {assignedPageNumber} • {assignments.length}
                            </button>
                          ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">No pages tagged in this brochure yet.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Page Links</p>
                    {currentPageAssignments.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {currentPageAssignments.map((assignment) => (
                          <button
                            key={assignment.displayId}
                            type="button"
                            onClick={() => onSelectDisplay(assignment.displayId)}
                            className="flex w-full items-center gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-left text-xs font-semibold text-emerald-800"
                          >
                            <CheckCircle2 size={14} />
                            <span className="truncate">{assignment.displayName}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">This page is not assigned to any screen yet.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Select a brochure to start marking pages</p>
                  <p className="mt-1 text-xs text-slate-500">Attached PDFs will render here with page navigation and tagging controls.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
