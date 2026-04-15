"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Columns3, Link2, ScanSearch, Trash2, Upload } from "lucide-react";

import type { StructuredDisplay } from "@/lib/displayExtractor";
import type { BrochureSpecColumnSelection, PdfTextItem, ProposalBrochureAttachment } from "@/types";

type Props = {
  brochures: ProposalBrochureAttachment[];
  displays: StructuredDisplay[];
  selectedBrochureId: string | null;
  selectedDisplayId: string | null;
  onSelectBrochure: (brochureId: string) => void;
  onSelectDisplay: (displayId: string) => void;
  onAssignPage: (
    displayId: string,
    brochureId: string,
    pageNumber: number,
    specColumn?: BrochureSpecColumnSelection | null,
  ) => void;
  onClearDisplayLink: (displayId: string) => void;
  onRemoveBrochure: (brochureId: string) => void;
  onUploadClick: () => void;
};

type PageAssignment = {
  displayId: string;
  displayName: string;
  brochureRef: StructuredDisplay["brochureRef"];
};

type PdfTextBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
};

type DetectedSpecColumn = BrochureSpecColumnSelection & {
  itemCount: number;
  isLikelyLabelColumn: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildTextBoxes(items: PdfTextItem[], canvasHeight: number, scale: number): PdfTextBox[] {
  return items
    .map((item) => {
      const text = item.str.trim();
      if (!text) return null;

      const fontSize = Math.max(8, Math.abs(item.transform[0]) * scale);
      const width = Math.max(6, item.width * scale);
      const x = item.transform[4] * scale;
      const y = canvasHeight - item.transform[5] * scale - fontSize;

      return {
        text,
        x,
        y,
        width,
        height: fontSize,
        centerX: x + width / 2,
      } satisfies PdfTextBox;
    })
    .filter((item): item is PdfTextBox => Boolean(item));
}

function detectSpecColumns(textItems: PdfTextItem[], pageWidth: number, pageHeight: number, scale: number): DetectedSpecColumn[] {
  const boxes = buildTextBoxes(textItems, pageHeight, scale).filter((box) => box.width >= 12);
  if (boxes.length < 12) return [];

  const clusters: Array<{
    items: PdfTextBox[];
    center: number;
  }> = [];
  const tolerance = Math.max(36, pageWidth * 0.045);

  for (const box of [...boxes].sort((a, b) => a.centerX - b.centerX)) {
    const cluster = clusters.find((candidate) => Math.abs(candidate.center - box.centerX) <= tolerance);
    if (cluster) {
      cluster.items.push(box);
      cluster.center = cluster.items.reduce((sum, item) => sum + item.centerX, 0) / cluster.items.length;
      continue;
    }

    clusters.push({
      items: [box],
      center: box.centerX,
    });
  }

  const normalized = clusters
    .map((cluster, index) => {
      const items = cluster.items.sort((a, b) => a.y - b.y);
      const minX = Math.min(...items.map((item) => item.x));
      const maxX = Math.max(...items.map((item) => item.x + item.width));
      const minY = Math.min(...items.map((item) => item.y));
      const maxY = Math.max(...items.map((item) => item.y + item.height));
      const joinedText = items.map((item) => item.text).join(" ");
      const digitRatio =
        joinedText.length > 0 ? (joinedText.match(/\d/g)?.length || 0) / joinedText.length : 0;
      const avgTextLength = joinedText.length > 0 ? joinedText.length / items.length : 0;
      const headerTexts = items
        .filter((item) => item.y <= minY + 56)
        .map((item) => item.text)
        .filter((text, textIndex, array) => array.indexOf(text) === textIndex)
        .slice(0, 3);
      const label = headerTexts.join(" / ") || `Column ${index + 1}`;

      return {
        id: `page-col-${index + 1}-${Math.round(minX)}`,
        label,
        x: clamp(minX - 10, 0, pageWidth),
        y: clamp(minY - 8, 0, pageHeight),
        width: clamp(maxX - minX + 20, 24, pageWidth),
        height: clamp(maxY - minY + 16, 32, pageHeight),
        textSample: items.slice(0, 6).map((item) => item.text),
        detectionSource: "pdf_text" as const,
        itemCount: items.length,
        digitRatio,
        avgTextLength,
      };
    })
    .filter((column) => column.itemCount >= 4 && column.width <= pageWidth * 0.42)
    .sort((a, b) => a.x - b.x);

  if (normalized.length === 0) return [];

  return normalized.map((column, index) => ({
    id: column.id,
    label: column.label,
    x: column.x,
    y: column.y,
    width: column.width,
    height: column.height,
    textSample: column.textSample,
    detectionSource: column.detectionSource,
    itemCount: column.itemCount,
    isLikelyLabelColumn:
      normalized.length >= 3 &&
      index === 0 &&
      column.x < pageWidth * 0.2 &&
      column.digitRatio < 0.12 &&
      column.avgTextLength > 5,
  }));
}

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
  const [textItems, setTextItems] = useState<PdfTextItem[]>([]);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);

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
    if (!selectedBrochure) return new Map<number, PageAssignment[]>();

    return displays.reduce((map, display) => {
      if (display.brochureRef?.brochureId !== selectedBrochure.id) return map;
      const existing = map.get(display.brochureRef.pageNumber) || [];
      existing.push({
        displayId: display.id,
        displayName: display.name,
        brochureRef: display.brochureRef,
      });
      map.set(display.brochureRef.pageNumber, existing);
      return map;
    }, new Map<number, PageAssignment[]>());
  }, [displays, selectedBrochure]);

  const currentPageAssignments = useMemo(() => pageAssignments.get(pageNumber) || [], [pageAssignments, pageNumber]);
  const currentPageSavedColumns = currentPageAssignments.filter(
    (assignment): assignment is PageAssignment & { brochureRef: NonNullable<PageAssignment["brochureRef"]> } =>
      Boolean(assignment.brochureRef?.specColumn),
  );

  const detectedColumns = useMemo(
    () => detectSpecColumns(textItems, canvasSize.width, canvasSize.height, 1.1),
    [canvasSize.height, canvasSize.width, textItems],
  );

  const activeSelectedColumn =
    detectedColumns.find((column) => column.id === selectedColumnId) ||
    currentPageSavedColumns.find((assignment) => assignment.displayId === selectedDisplay?.id)?.brochureRef?.specColumn ||
    null;

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
    setTextItems([]);
    setSelectedColumnId(null);
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

        const textContent = await page.getTextContent();
        const items = (textContent.items as PdfTextItem[]).filter((item) => typeof item?.str === "string");
        if (!disposed) {
          setTextItems(items);
        }
      } catch (error) {
        console.error("Brochure PDF render failed", error);
        if (!disposed) {
          setRenderError(error instanceof Error ? error.message : "Failed to render brochure page");
          setCanvasSize({ width: 0, height: 0 });
          setTextItems([]);
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

  useEffect(() => {
    const savedColumn =
      currentPageAssignments.find((assignment) => assignment.displayId === selectedDisplay?.id)?.brochureRef?.specColumn || null;

    if (savedColumn) {
      setSelectedColumnId(savedColumn.id);
      return;
    }

    setSelectedColumnId(null);
  }, [currentPageAssignments, pageNumber, selectedDisplay?.id]);

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">PDF Brochure Spec Markup</p>
          <p className="mt-1 text-xs text-slate-500">
            Attach brochures, detect spec-table columns, and save the exact product-variant column for each screen.
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
          <p className="mt-1 text-xs text-slate-500">Upload one or more product PDFs to start tagging spec columns to displays.</p>
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
                        <div className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                          <span className="block truncate">
                            {display.brochureRef.brochureName} • Page {display.brochureRef.pageNumber}
                          </span>
                          <span className="mt-0.5 block truncate">
                            {display.brochureRef.specColumn?.label || "Whole page linked"}
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onClearDisplayLink(display.id);
                            }}
                            className="mt-1 font-semibold text-rose-600 hover:text-rose-700"
                          >
                            Clear
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] text-slate-400">No brochure spec column linked yet</p>
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
                    <p className="mt-1 text-[11px] text-slate-500">Navigate pages, detect spec columns, then tag the matching product column to the active screen.</p>
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
                    <p className="mt-1 text-[11px] text-indigo-800">
                      {activeSelectedColumn ? `Selected column: ${activeSelectedColumn.label}` : "Select one detected product column on this page."}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedDisplay || (detectedColumns.length > 0 && !activeSelectedColumn)}
                    onClick={() => {
                      if (!selectedDisplay || !selectedBrochure) return;
                      onAssignPage(selectedDisplay.id, selectedBrochure.id, pageNumber, activeSelectedColumn);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Link2 size={14} />
                    {detectedColumns.length > 0 ? "Tag Selected Column" : "Tag This Page"}
                  </button>
                </div>

                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                      <ScanSearch size={13} />
                      Column Detection
                    </span>
                    {detectedColumns.length > 0 ? (
                      <span className="text-slate-500">
                        Found {detectedColumns.length} candidate column{detectedColumns.length === 1 ? "" : "s"} from the brochure text layer.
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        No clear multi-column spec table detected on this page yet.
                      </span>
                    )}
                  </div>
                  {detectedColumns.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {detectedColumns.map((column) => {
                        const isSelected = activeSelectedColumn?.id === column.id;
                        return (
                          <button
                            key={column.id}
                            type="button"
                            onClick={() => setSelectedColumnId(column.id)}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                              isSelected
                                ? "border-indigo-300 bg-indigo-100 text-indigo-800"
                                : column.isLikelyLabelColumn
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-slate-200 bg-slate-50 text-slate-700"
                            }`}
                          >
                            {column.label}
                            {column.isLikelyLabelColumn ? " • labels?" : ""}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
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
                    <div className="relative mx-auto" style={{ width: canvasSize.width || undefined, minHeight: canvasSize.height || undefined }}>
                      <canvas ref={canvasRef} className="mx-auto block max-w-full shadow-sm" />

                      {currentPageSavedColumns.map((assignment, index) => {
                        const column = assignment.brochureRef.specColumn!;
                        return (
                          <div
                            key={`${assignment.displayId}-${column.id}-${index}`}
                            className="pointer-events-none absolute rounded-md border-2 border-emerald-500 bg-emerald-400/15"
                            style={{
                              left: column.x,
                              top: column.y,
                              width: column.width,
                              height: column.height,
                            }}
                          >
                            <div className="absolute left-2 top-2 rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white shadow">
                              {assignment.displayName}
                            </div>
                          </div>
                        );
                      })}

                      {detectedColumns.map((column) => {
                        const isSelected = activeSelectedColumn?.id === column.id;
                        const hasSavedAssignment = currentPageSavedColumns.some(
                          (assignment) => assignment.brochureRef.specColumn?.id === column.id,
                        );

                        return (
                          <button
                            key={column.id}
                            type="button"
                            onClick={() => setSelectedColumnId(column.id)}
                            className={`absolute rounded-md border-2 transition-all ${
                              hasSavedAssignment
                                ? "border-emerald-500 bg-emerald-400/10"
                                : isSelected
                                  ? "border-indigo-500 bg-indigo-400/12"
                                  : column.isLikelyLabelColumn
                                    ? "border-amber-300 bg-amber-300/8"
                                    : "border-sky-300/80 bg-sky-300/8 hover:bg-sky-300/12"
                            }`}
                            style={{
                              left: column.x,
                              top: column.y,
                              width: column.width,
                              height: column.height,
                            }}
                            title={column.label}
                          >
                            <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm">
                              {column.label}
                            </span>
                          </button>
                        );
                      })}

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
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tagged Pages</p>
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
                      <p className="mt-2 text-xs text-slate-500">No brochure pages tagged yet.</p>
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
                            className="w-full rounded-lg bg-emerald-50 px-2 py-1.5 text-left text-xs font-semibold text-emerald-800"
                          >
                            <span className="flex items-center gap-2">
                              <CheckCircle2 size={14} />
                              <span className="truncate">{assignment.displayName}</span>
                            </span>
                            <span className="mt-1 block truncate pl-6 text-[11px] text-emerald-700">
                              {assignment.brochureRef?.specColumn?.label || "Whole page"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">This page is not assigned to any screen yet.</p>
                    )}
                  </div>
                </div>

                {activeSelectedColumn ? (
                  <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Selected Spec Column</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem]">
                      <div>
                        <p className="text-sm font-semibold text-indigo-950">{activeSelectedColumn.label}</p>
                        <p className="mt-1 text-xs text-indigo-800">
                          Sample text: {activeSelectedColumn.textSample.slice(0, 3).join(" • ") || "No sample text"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold">Detection</p>
                        <p className="mt-1 inline-flex items-center gap-1">
                          <Columns3 size={12} />
                          PDF text geometry
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Select a brochure to start marking columns</p>
                  <p className="mt-1 text-xs text-slate-500">Attached PDFs will render here with page navigation and column tagging controls.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
