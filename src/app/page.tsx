"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText,
  Upload,
  Download,
  History,
  Loader2,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
  ChevronLeft,
  ChevronRight,
  Database,
  Filter,
  CheckCircle2,
  AlertTriangle,
  CircleOff,
  ShieldAlert,
  Eye,
  EyeOff,
  RotateCcw
} from "lucide-react";
import axios from "axios";
import dynamic from "next/dynamic";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import * as XLSX from "xlsx";

import { OcrProvider, API_BASE_URLS } from "@/lib/constants";
import { extractDisplayContent } from "@/lib/utils";
import { extractRfpMeta, RelevanceLabel, scoreRfpChunk, splitIntoChunks, toChunkTitle } from "@/lib/rfpFilter";
import {
  buildStructuredWorkbook,
  parseStructuredWorkbookFromSheets,
  structuredWorkbookToMarkdown,
  StructuredWorkbook,
} from "@/lib/rfpWorkbook";
import { useFileProcessor } from "@/hooks/useFileProcessor";
import { usePdfExport } from "@/hooks/usePdfExport";
import { HistoryItem } from "@/types";

// Dynamically import Editor to avoid SSR issues with BlockNote/Mantine
const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });
const PdfHoverPreview = dynamic(() => import("@/components/PdfHoverPreview"), { ssr: false });

type RelevanceChunk = {
  id: string;
  title: string;
  text: string;
  label: RelevanceLabel;
  score: number;
  reason: string;
  categoryHits: string[];
  riskHits: string[];
  matchedKeywords: string[];
  boosterHits: string[];
  drawingCandidate: boolean;
};

type RelevanceSummary = {
  total: number;
  processed: number;
  progress: number;
  relevant: number;
  maybe: number;
  irrelevant: number;
  riskFlagged: number;
  drawingCandidates: number;
  chunks: RelevanceChunk[];
  relevantContent: string;
  meta: {
    clientName: string | null;
    venueName: string | null;
    projectTitle: string | null;
  };
};

type EditorSourceMode = "full" | "relevant" | "workbook" | "blank";
type WorkbookSheetPreview = { name: string; html: string; rowCount: number };
type DiffBucket = {
  added: string[];
  edited: string[];
  removed: string[];
};

type WorkbookDiffSummary = {
  requirements: DiffBucket;
  pricing: DiffBucket;
  schedule: DiffBucket;
  risks: DiffBucket;
  assumptions: DiffBucket;
};

function buildDiffBucket<T extends { id: string }>(
  previous: T[],
  next: T[],
  getLabel: (item: T) => string,
  isSameContent: (a: T, b: T) => boolean,
): DiffBucket {
  const prevById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));

  const added: string[] = [];
  const edited: string[] = [];
  const removed: string[] = [];

  for (const [id, nextItem] of nextById) {
    const prevItem = prevById.get(id);
    if (!prevItem) {
      added.push(getLabel(nextItem));
      continue;
    }
    if (!isSameContent(prevItem, nextItem)) {
      edited.push(getLabel(nextItem));
    }
  }

  for (const [id, prevItem] of prevById) {
    if (!nextById.has(id)) {
      removed.push(getLabel(prevItem));
    }
  }

  return { added, edited, removed };
}

function diffStructuredWorkbooks(previous: StructuredWorkbook | null, next: StructuredWorkbook): WorkbookDiffSummary | null {
  if (!previous) return null;

  return {
    requirements: buildDiffBucket(
      previous.requirements,
      next.requirements,
      (item) => `${item.id}: ${item.text}`,
      (a, b) => a.text === b.text && a.category === b.category && a.priority === b.priority && a.citation === b.citation,
    ),
    pricing: buildDiffBucket(
      previous.pricing,
      next.pricing,
      (item) => `${item.id}: ${item.item} (${item.amount})`,
      (a, b) => a.item === b.item && a.amount === b.amount && a.citation === b.citation,
    ),
    schedule: buildDiffBucket(
      previous.schedule,
      next.schedule,
      (item) => `${item.id}: ${item.milestone} (${item.dueText})`,
      (a, b) => a.milestone === b.milestone && a.dueText === b.dueText && a.citation === b.citation,
    ),
    risks: buildDiffBucket(
      previous.risks,
      next.risks,
      (item) => `${item.id}: ${item.risk}`,
      (a, b) => a.risk === b.risk && a.severity === b.severity && a.citation === b.citation,
    ),
    assumptions: buildDiffBucket(
      previous.assumptions,
      next.assumptions,
      (item) => `${item.id}: ${item.text}`,
      (a, b) => a.text === b.text && a.citation === b.citation,
    ),
  };
}

export default function Home() {
  const workbookImportInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<"document" | "json">("document");
  const [isNavOpen, setIsNavOpen] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(true);
  const [previewMode, setPreviewMode] = useState<"auto" | "on-demand">("auto");
  const [isPreviewVisible, setIsPreviewVisible] = useState(true);
  const [activeExcelSheet, setActiveExcelSheet] = useState("");
  const [ocrProvider, setOcrProvider] = useState<OcrProvider>("kreuzberg");
  const [editorEnabled, setEditorEnabled] = useState(false);
  const [editorSourceMode, setEditorSourceMode] = useState<EditorSourceMode>("full");
  const [workbookEditorContent, setWorkbookEditorContent] = useState("");
  const [isAnalyzingRelevance, setIsAnalyzingRelevance] = useState(false);
  const [isGeneratingWorkbook, setIsGeneratingWorkbook] = useState(false);
  const [structuredWorkbook, setStructuredWorkbook] = useState<StructuredWorkbook | null>(null);
  const [workbookDiff, setWorkbookDiff] = useState<WorkbookDiffSummary | null>(null);
  const [workbookSheets, setWorkbookSheets] = useState<WorkbookSheetPreview[]>([]);
  const [activeWorkbookSheet, setActiveWorkbookSheet] = useState<string>("");
  const [relevanceSummary, setRelevanceSummary] = useState<RelevanceSummary>({
    total: 0,
    processed: 0,
    progress: 0,
    relevant: 0,
    maybe: 0,
    irrelevant: 0,
    riskFlagged: 0,
    drawingCandidates: 0,
    chunks: [],
    relevantContent: "",
    meta: {
      clientName: null,
      venueName: null,
      projectTitle: null,
    },
  });
  
  const {
    file,
    previewUrl,
    excelData,
    excelSheets,
    isExtracting,
    extractedContent,
    jsonResult,
    error,
    processFile,
    extractContent,
    clearFile,
    clearError,
    setHistoryItem,
  } = useFileProcessor();
  
  const { isExporting, exportPdfToImages } = usePdfExport();

  const workflowSteps = [
    "Receive RFP",
    "Extract Text",
    "Filter Relevance",
    "Build Workbook",
    "Edit + Export",
  ] as const;

  const workflowIndex = (() => {
    if (!file) return 0;
    if (!extractedContent) return 1;
    if (relevanceSummary.total === 0) return 2;
    if (!structuredWorkbook) return 3;
    return 4;
  })();

  const activeExcelSheetData =
    excelSheets.find((sheet) => sheet.name === activeExcelSheet) || excelSheets[0] || null;

  const fetchHistory = useCallback(async () => {
    try {
      const response = await axios.get("/api/extract");
      setHistory(response.data);
    } catch (error) {
      console.error("Failed to fetch history", error);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchHistory();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchHistory]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
      setIsPreviewVisible(previewMode === "auto");
      clearError();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
      setIsPreviewVisible(previewMode === "auto");
      clearError();
    }
  };

  const handleDownloadPdfImages = async () => {
    if (!file) return;
    await exportPdfToImages(file);
  };

  const handleUpload = async () => {
    if (!file) return;
    
    // Show warning if using Marker or Docling
    if (ocrProvider === 'marker' || ocrProvider === 'docling') {
      const serviceName = ocrProvider === 'marker' ? 'Marker' : 'Docling';
      const serviceUrl = ocrProvider === 'marker' ? API_BASE_URLS.marker : API_BASE_URLS.docling;
      console.warn(`${serviceName} service may not be running. Expected at: ${serviceUrl}`);
    }
    
    const extractedText = await extractContent(ocrProvider);
    if (extractedText) {
      setEditorSourceMode("full");
      setEditorEnabled(true);
      await runRelevanceAnalysis(extractedText);
    }
    fetchHistory();
  };

  const handleSelectHistoryItem = (item: HistoryItem) => {
    setHistoryItem(item);
    setEditorSourceMode("full");
    setEditorEnabled(true);
    try {
      const parsed = JSON.parse(item.content);
      const text = extractDisplayContent(parsed);
      void runRelevanceAnalysis(text);
    } catch {
      setRelevanceSummary({
        total: 0,
        processed: 0,
        progress: 0,
        relevant: 0,
        maybe: 0,
        irrelevant: 0,
        riskFlagged: 0,
        drawingCandidates: 0,
        chunks: [],
        relevantContent: "",
        meta: {
          clientName: null,
          venueName: null,
          projectTitle: null,
        },
      });
    }
  };

  const handleReset = () => {
    clearFile();
    clearError();
    setEditorEnabled(false);
    setEditorSourceMode("blank");
    setStructuredWorkbook(null);
    setWorkbookDiff(null);
    setWorkbookEditorContent("");
    setWorkbookSheets([]);
    setActiveWorkbookSheet("");
    setRelevanceSummary({
      total: 0,
      processed: 0,
      progress: 0,
      relevant: 0,
      maybe: 0,
      irrelevant: 0,
      riskFlagged: 0,
      drawingCandidates: 0,
      chunks: [],
      relevantContent: "",
      meta: {
        clientName: null,
        venueName: null,
        projectTitle: null,
      },
    });
    setIsPreviewVisible(true);
  };

  const handleEnableEditor = () => {
    setEditorEnabled(true);
    setEditorSourceMode("blank");
  };

  const buildWorkbookArtifacts = (model: StructuredWorkbook) => {
    const workbook = XLSX.utils.book_new();

    const appendSheet = (name: string, headers: string[], rows: Array<Array<string | number>>) => {
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };

    appendSheet("Project", ["Field", "Value"], [
      ["Project Title", model.project.projectTitle],
      ["Client", model.project.clientName],
      ["Venue", model.project.venueName],
      ["Generated At", model.project.generatedAt],
      ["Requirements", model.requirements.length],
      ["Pricing Lines", model.pricing.length],
      ["Schedule Items", model.schedule.length],
      ["Risks", model.risks.length],
      ["Assumptions", model.assumptions.length],
    ]);

    appendSheet(
      "Requirements",
      ["ID", "Requirement", "Category", "Priority", "Source", "Citation"],
      model.requirements.map((item) => [item.id, item.text, item.category, item.priority, item.source, item.citation]),
    );

    appendSheet(
      "Pricing",
      ["ID", "Item", "Amount", "Source", "Citation"],
      model.pricing.map((item) => [item.id, item.item, item.amount, item.source, item.citation]),
    );

    appendSheet(
      "Schedule",
      ["ID", "Milestone", "Due", "Source", "Citation"],
      model.schedule.map((item) => [item.id, item.milestone, item.dueText, item.source, item.citation]),
    );

    appendSheet(
      "Risks",
      ["ID", "Risk", "Severity", "Source", "Citation"],
      model.risks.map((item) => [item.id, item.risk, item.severity, item.source, item.citation]),
    );

    appendSheet(
      "Assumptions",
      ["ID", "Assumption", "Source", "Citation"],
      model.assumptions.map((item) => [item.id, item.text, item.source, item.citation]),
    );

    appendSheet(
      "Sources",
      ["Chunk ID", "Title", "Score", "Label", "Citation"],
      model.sources.map((source) => [source.id, source.title, source.score, source.label, source.id]),
    );

    const previews: WorkbookSheetPreview[] = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
      const rowCount = range ? range.e.r : 0;
      return {
        name,
        html: XLSX.utils.sheet_to_html(sheet),
        rowCount,
      };
    });

    return { workbook, previews };
  };

  const generateStructuredWorkbook = async () => {
    if (isGeneratingWorkbook || relevanceSummary.chunks.length === 0) return;

    setIsGeneratingWorkbook(true);
    try {
      const model = buildStructuredWorkbook(relevanceSummary.chunks, relevanceSummary.meta);
      const { previews } = buildWorkbookArtifacts(model);
      setStructuredWorkbook(model);
      setWorkbookDiff(null);
      setWorkbookEditorContent(structuredWorkbookToMarkdown(model));
      setWorkbookSheets(previews);
      if (previews.length > 0) {
        setActiveWorkbookSheet(previews[0].name);
      }
    } finally {
      setIsGeneratingWorkbook(false);
    }
  };

  const exportWorkbookXlsx = async () => {
    const model = structuredWorkbook || buildStructuredWorkbook(relevanceSummary.chunks, relevanceSummary.meta);
    if (!structuredWorkbook) {
      const { previews } = buildWorkbookArtifacts(model);
      setStructuredWorkbook(model);
      setWorkbookDiff(null);
      setWorkbookSheets(previews);
      if (previews.length > 0) setActiveWorkbookSheet(previews[0].name);
    }

    const { workbook } = buildWorkbookArtifacts(model);
    const xlsxData = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([xlsxData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rfp-structured-workbook.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const importWorkbookXlsx = async (uploadedFile: File) => {
    const buffer = await uploadedFile.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetRows: Record<string, Record<string, unknown>[]> = {};

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      sheetRows[sheetName] = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
      }) as Record<string, unknown>[];
    }

    const parsed = parseStructuredWorkbookFromSheets(sheetRows);
    if (!parsed) {
      throw new Error("Could not parse structured workbook sheets.");
    }

    const diff = diffStructuredWorkbooks(structuredWorkbook, parsed);
    const { previews } = buildWorkbookArtifacts(parsed);
    const markdown = structuredWorkbookToMarkdown(parsed);
    setStructuredWorkbook(parsed);
    setWorkbookDiff(diff);
    setWorkbookSheets(previews);
    setActiveWorkbookSheet(previews[0]?.name || "");
    setWorkbookEditorContent(markdown);
    setEditorSourceMode("workbook");
    setEditorEnabled(true);
    setIsEditorOpen(true);
    setActiveTab("document");
  };

  const runRelevanceAnalysis = useCallback(async (rawText: string) => {
    setStructuredWorkbook(null);
    setWorkbookDiff(null);
    setWorkbookSheets([]);
    setActiveWorkbookSheet("");
    const meta = extractRfpMeta(rawText);
    const parts = splitIntoChunks(rawText);
    if (parts.length === 0) {
      setRelevanceSummary({
        total: 0,
        processed: 0,
        progress: 0,
        relevant: 0,
        maybe: 0,
        irrelevant: 0,
        riskFlagged: 0,
        drawingCandidates: 0,
        chunks: [],
        relevantContent: "",
        meta,
      });
      return;
    }

    setIsAnalyzingRelevance(true);
    setRelevanceSummary({
      total: parts.length,
      processed: 0,
      progress: 0,
      relevant: 0,
      maybe: 0,
      irrelevant: 0,
      riskFlagged: 0,
      drawingCandidates: 0,
      chunks: [],
      relevantContent: "",
      meta,
    });

    const chunks: RelevanceChunk[] = [];
    let relevant = 0;
    let maybe = 0;
    let irrelevant = 0;
    let riskFlagged = 0;
    let drawingCandidates = 0;

    for (let i = 0; i < parts.length; i += 1) {
      const chunkText = parts[i];
      const scored = scoreRfpChunk(chunkText);
      if (scored.label === "relevant") relevant += 1;
      if (scored.label === "maybe") maybe += 1;
      if (scored.label === "irrelevant") irrelevant += 1;
      if (scored.riskHits.length > 0) riskFlagged += 1;
      if (scored.drawingCandidate) drawingCandidates += 1;

      chunks.push({
        id: `chunk-${i}`,
        title: toChunkTitle(chunkText, i),
        text: chunkText,
        label: scored.label,
        score: scored.score,
        reason: scored.reason,
        categoryHits: scored.categoryHits,
        riskHits: scored.riskHits,
        matchedKeywords: scored.matchedKeywords,
        boosterHits: scored.boosterHits,
        drawingCandidate: scored.drawingCandidate,
      });

      const processed = i + 1;
      if (processed % 8 === 0 || processed === parts.length) {
        setRelevanceSummary((prev) => ({
          ...prev,
          processed,
          progress: Math.round((processed / parts.length) * 100),
          relevant,
          maybe,
          irrelevant,
          riskFlagged,
          drawingCandidates,
          chunks: [...chunks],
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const relevantContent = chunks
      .filter((chunk) => chunk.label !== "irrelevant")
      .map((chunk) => `## ${chunk.title}\n\n${chunk.text}`)
      .join("\n\n---\n\n");

    setRelevanceSummary({
      total: parts.length,
      processed: parts.length,
      progress: 100,
      relevant,
      maybe,
      irrelevant,
      riskFlagged,
      drawingCandidates,
      chunks,
      relevantContent,
      meta,
    });
    setIsAnalyzingRelevance(false);
  }, []);

  return (
    <MantineProvider>
      <main className="flex h-screen bg-slate-100 overflow-hidden font-sans p-3 gap-3">
        {/* Sidebar: History */}
        <aside className={`${isNavOpen ? "w-72" : "w-14"} bg-white border border-slate-200 rounded-2xl flex flex-col shadow-sm overflow-hidden transition-all`}>
          {isNavOpen ? (
            <>
              <div className="p-4 border-b flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">History</p>
                <button
                  onClick={() => setIsNavOpen(false)}
                  className="ml-auto h-9 w-9 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  title="Collapse navigation"
                >
                  <ChevronLeft size={18} className="mx-auto" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center gap-2 mb-4 text-gray-500 font-semibold text-xs uppercase tracking-wider">
                  <History size={14} />
                  Extraction History
                </div>
                
                <div className="space-y-2">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        handleSelectHistoryItem(item);
                      }}
                      className="w-full text-left p-3 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg group-hover:bg-indigo-100 transition-colors">
                          <FileText size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.filename}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <ChevronRight size={14} className="text-gray-300 group-hover:text-indigo-400" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 border-t bg-gray-50">
                <div className="flex items-center gap-2 text-gray-500 text-xs">
                  <Database size={12} />
                  <span>SQLite Database Active</span>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-between py-4">
              <button
                onClick={() => setIsNavOpen(true)}
                className="h-10 w-10 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                title="Open navigation"
              >
                <ChevronRight size={18} className="mx-auto" />
              </button>
              <span className="text-[10px] font-semibold text-slate-400 tracking-wider rotate-180" style={{ writingMode: "vertical-rl" }}>
                HISTORY
              </span>
              <span className="h-10 w-10" />
            </div>
          )}
        </aside>

        {/* Middle Section: Preview & Upload */}
        <section className={`${isPreviewOpen ? "flex-1" : "w-14"} flex flex-col bg-white border border-slate-200 rounded-2xl min-w-0 overflow-hidden transition-all`}>
          {isPreviewOpen ? (
            <>
              <header className="h-16 border-b flex items-center justify-between px-6 bg-white z-10 sticky top-0">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <Upload size={18} className="text-indigo-600" />
                  Document Preview
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleReset}
                    className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
                    title="Reset file, results and editor"
                  >
                    <RotateCcw size={13} />
                    Reset
                  </button>
                  <select
                    value={ocrProvider}
                    onChange={(e) => setOcrProvider(e.target.value as OcrProvider)}
                    className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 bg-white"
                    title="OCR provider"
                  >
                    <option value="marker">Marker (Best Formatting)</option>
                    <option value="docling">Docling (Precise Tables)</option>
                    <option value="mistral">Mistral OCR</option>
                    <option value="kreuzberg">Kreuzberg OCR</option>
                    <option value="ollama_glm_ocr">GLM-OCR (Ollama)</option>
                  </select>
                  {file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) && (
                    <button
                      onClick={handleDownloadPdfImages}
                      disabled={isExporting}
                      className="inline-flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                      title="Download each PDF page as PNG"
                    >
                      {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      {isExporting ? "Exporting..." : "Download Images"}
                    </button>
                  )}
                  {file && (previewUrl || excelData) ? (
                    <button
                      onClick={() => setIsPreviewVisible((visible) => !visible)}
                      className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      title={isPreviewVisible ? "Hide preview" : "Show preview"}
                    >
                      {isPreviewVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                      {isPreviewVisible ? "Hide Preview" : "Show Preview"}
                    </button>
                  ) : null}
                  <button
                    onClick={() =>
                      setPreviewMode((mode) => {
                        const next = mode === "auto" ? "on-demand" : "auto";
                        if (next === "auto" && file) setIsPreviewVisible(true);
                        return next;
                      })
                    }
                    className="inline-flex items-center h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    title="Toggle preview behavior"
                  >
                    Preview: {previewMode === "auto" ? "Auto" : "On-demand"}
                  </button>
                  {error && (
                    <button
                      onClick={clearError}
                      className="inline-flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-100 transition-all text-sm font-semibold"
                      title="Clear error"
                    >
                      Clear Error
                    </button>
                  )}
                  {file && !isExtracting && !extractedContent && !error && (
                    <button
                      onClick={handleUpload}
                      className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-all text-sm font-semibold shadow-md"
                    >
                      Extract Content
                    </button>
                  )}
                  <button
                    onClick={() => setIsPreviewOpen(false)}
                    className="h-9 w-9 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                    title="Collapse preview"
                  >
                    <ChevronLeft size={16} className="mx-auto" />
                  </button>
                </div>
              </header>

              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                <div className="flex items-center gap-2 overflow-x-auto">
                  {workflowSteps.map((label, index) => (
                    <div
                      key={label}
                      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
                        index < workflowIndex
                          ? "bg-emerald-100 text-emerald-800"
                          : index === workflowIndex
                            ? "bg-indigo-100 text-indigo-800"
                            : "bg-white text-slate-500 border border-slate-200"
                      }`}
                    >
                      {index + 1}. {label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 md:p-8 flex flex-col items-center justify-center relative">
            {!file ? (
              <label
                className="w-full max-w-lg aspect-square border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all group bg-white shadow-sm"
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDrop={handleDrop}
              >
                <div className="p-6 bg-indigo-50 rounded-full text-indigo-600 group-hover:scale-110 transition-transform">
                  <Upload size={48} />
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-800">Drop your file here</p>
                  <p className="text-sm text-gray-500 mt-1">PNG, JPG, PDF, XLSX or CSV</p>
                </div>
                <input type="file" className="hidden" onChange={handleFileChange} accept=".png,.jpg,.jpeg,.pdf,.xlsx,.xls,.csv" />
              </label>
            ) : (
              <div className="w-full h-full flex flex-col gap-4">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                      {file.type.startsWith("image/") ? <ImageIcon size={20} /> : 
                       file.name.endsWith(".xlsx") || file.name.endsWith(".csv") ? <FileSpreadsheet size={20} /> : 
                       <FileIcon size={20} />}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 leading-none">{file.name}</h3>
                      <p className="text-xs text-gray-400 mt-1">
                        Ready for extraction • {
                          ocrProvider === "marker" ? "Marker (Best Formatting)" :
                          ocrProvider === "docling" ? "Docling (Precise Tables)" :
                          ocrProvider === "mistral" ? "Mistral OCR" :
                          ocrProvider === "ollama_glm_ocr" ? "GLM-OCR (Ollama)" :
                          "Kreuzberg OCR"
                        }
                      </p>
                    </div>
                  </div>
                  <button onClick={clearFile} className="text-xs text-red-500 hover:underline">Change File</button>
                </div>
                
                <div className="flex-1 bg-gray-100 rounded-2xl overflow-hidden border border-gray-200 shadow-inner flex items-center justify-center min-h-0">
                  {!isPreviewVisible ? (
                    <div className="text-center p-8">
                      <p className="text-sm font-semibold text-slate-700">Preview is hidden (On-demand mode)</p>
                      <button
                        type="button"
                        onClick={() => setIsPreviewVisible(true)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Eye size={13} />
                        Open Preview
                      </button>
                    </div>
                  ) : previewUrl && file.type === "application/pdf" ? (
                    <PdfHoverPreview fileUrl={previewUrl} />
                  ) : previewUrl ? (
                    <img src={previewUrl} alt="Preview" className="max-w-full max-h-full object-contain p-4 shadow-2xl" />
                  ) : excelData ? (
                    <div className="w-full h-full bg-white overflow-hidden">
                      <div className="h-9 bg-emerald-700 text-white text-xs font-semibold px-3 flex items-center justify-between">
                        <span className="truncate">{file.name}</span>
                        <span>{activeExcelSheetData ? `${activeExcelSheetData.rowCount} rows` : "Spreadsheet Preview"}</span>
                      </div>
                      {excelSheets.length > 0 ? (
                        <div className="h-9 border-b border-slate-200 bg-slate-50 px-2 flex items-center gap-2 overflow-x-auto">
                          {excelSheets.map((sheet) => (
                            <button
                              key={sheet.name}
                              type="button"
                              onClick={() => setActiveExcelSheet(sheet.name)}
                              className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${
                                (activeExcelSheetData?.name || "") === sheet.name
                                  ? "bg-white border border-emerald-200 text-emerald-700"
                                  : "text-slate-600 hover:bg-white"
                              }`}
                            >
                              {sheet.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div
                        className="h-[calc(100%-4.5rem)] overflow-auto p-4 prose prose-sm max-w-none bg-slate-50"
                        dangerouslySetInnerHTML={{ __html: activeExcelSheetData?.html || excelData }}
                      />
                    </div>
                  ) : (
                    <div className="text-center p-8">
                      <FileIcon size={64} className="mx-auto text-gray-300 mb-4" />
                      <p className="text-gray-500">Preview not available for this file type</p>
                    </div>
                  )}
                </div>

                {(isAnalyzingRelevance || relevanceSummary.total > 0) && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Filter size={16} className="text-indigo-600" />
                        <p className="text-sm font-semibold text-slate-900">RFP Relevance Filter</p>
                      </div>
                      <p className="text-xs text-slate-500">
                        {isAnalyzingRelevance
                          ? `Analyzing ${relevanceSummary.processed}/${relevanceSummary.total}`
                          : `Done • ${relevanceSummary.total} sections`}
                      </p>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 transition-all"
                        style={{ width: `${relevanceSummary.progress}%` }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">
                        <div className="flex items-center gap-1">
                          <CheckCircle2 size={13} />
                          Relevant
                        </div>
                        <p className="mt-1 text-base font-bold">{relevanceSummary.relevant}</p>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                        <div className="flex items-center gap-1">
                          <AlertTriangle size={13} />
                          Maybe
                        </div>
                        <p className="mt-1 text-base font-bold">{relevanceSummary.maybe}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-700">
                        <div className="flex items-center gap-1">
                          <CircleOff size={13} />
                          Irrelevant
                        </div>
                        <p className="mt-1 text-base font-bold">{relevanceSummary.irrelevant}</p>
                      </div>
                      <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-800">
                        <div className="flex items-center gap-1">
                          <ShieldAlert size={13} />
                          Risk
                        </div>
                        <p className="mt-1 text-base font-bold">{relevanceSummary.riskFlagged}</p>
                      </div>
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-indigo-800">
                        <div className="flex items-center gap-1">
                          <Filter size={13} />
                          Drawings
                        </div>
                        <p className="mt-1 text-base font-bold">{relevanceSummary.drawingCandidates}</p>
                      </div>
                    </div>
                    {(relevanceSummary.meta.projectTitle || relevanceSummary.meta.clientName || relevanceSummary.meta.venueName) && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        {relevanceSummary.meta.projectTitle ? <p className="truncate"><span className="font-semibold">Project:</span> {relevanceSummary.meta.projectTitle}</p> : null}
                        {relevanceSummary.meta.clientName ? <p className="truncate"><span className="font-semibold">Client:</span> {relevanceSummary.meta.clientName}</p> : null}
                        {relevanceSummary.meta.venueName ? <p className="truncate"><span className="font-semibold">Venue:</span> {relevanceSummary.meta.venueName}</p> : null}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => workbookImportInputRef.current?.click()}
                      className="rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700 px-3 py-2 text-xs font-semibold hover:bg-cyan-100"
                    >
                      Import XLSX
                    </button>
                    <input
                      ref={workbookImportInputRef}
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={(e) => {
                        const uploadedFile = e.target.files?.[0];
                        if (!uploadedFile) return;
                        void importWorkbookXlsx(uploadedFile).catch((importError: unknown) => {
                          console.error("Workbook import failed", importError);
                        });
                        e.currentTarget.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void generateStructuredWorkbook()}
                      disabled={isAnalyzingRelevance || relevanceSummary.chunks.length === 0 || isGeneratingWorkbook}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50"
                      >
                        {isGeneratingWorkbook ? "Generating Workbook..." : "Generate Workbook"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportWorkbookXlsx()}
                        disabled={relevanceSummary.chunks.length === 0}
                        className="rounded-lg border border-slate-200 bg-white text-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                      >
                        Export XLSX
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!relevanceSummary.relevantContent) return;
                          setEditorSourceMode("relevant");
                          setIsEditorOpen(true);
                          setActiveTab("document");
                          setEditorEnabled(true);
                        }}
                        disabled={!relevanceSummary.relevantContent || isAnalyzingRelevance}
                        className="rounded-lg bg-indigo-600 text-white px-3 py-2 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
                      >
                        Open Relevant in Editor
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditorSourceMode("full");
                          setIsEditorOpen(true);
                          setActiveTab("document");
                          setEditorEnabled(true);
                        }}
                        disabled={!extractedContent}
                        className="rounded-lg border border-slate-200 bg-white text-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                      >
                        Open Full Document
                      </button>
                    </div>
                    {relevanceSummary.chunks.length > 0 && (
                      <div className="mt-3 max-h-32 overflow-auto space-y-1">
                        {relevanceSummary.chunks
                          .filter((chunk) => chunk.label !== "irrelevant")
                          .slice(0, 5)
                          .map((chunk) => (
                            <div
                              key={chunk.id}
                              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5"
                            >
                              <p className="text-xs font-semibold text-slate-800 truncate">{chunk.title}</p>
                              <p className="text-[11px] text-slate-500 truncate">
                                {chunk.reason}
                                {chunk.categoryHits.length > 0 ? ` • ${chunk.categoryHits.join(", ")}` : ""}
                                {chunk.riskHits.length > 0 ? ` • risk: ${chunk.riskHits.join(", ")}` : ""}
                                {chunk.matchedKeywords.length > 0 ? ` • kw: ${chunk.matchedKeywords.slice(0, 2).join(", ")}` : ""}
                              </p>
                            </div>
                          ))}
                      </div>
                    )}
                    {workbookSheets.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
                        <div className="h-10 border-b border-slate-200 px-2 flex items-center gap-2 overflow-x-auto bg-slate-50">
                          {workbookSheets.map((sheet) => (
                            <button
                              key={sheet.name}
                              type="button"
                              onClick={() => setActiveWorkbookSheet(sheet.name)}
                              className={`shrink-0 px-2 py-1 rounded-md text-xs font-semibold ${
                                activeWorkbookSheet === sheet.name
                                  ? "bg-white text-indigo-700 border border-indigo-200"
                                  : "text-slate-600 hover:bg-white"
                              }`}
                            >
                              {sheet.name}
                            </button>
                          ))}
                        </div>
                        <div className="max-h-64 overflow-auto bg-white p-3">
                          <div
                            className="prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{
                              __html:
                                workbookSheets.find((sheet) => sheet.name === activeWorkbookSheet)?.html ||
                                workbookSheets[0].html,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {workbookDiff ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-semibold text-amber-900">Workbook Import Diff</p>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-amber-900">
                          {(
                            [
                              ["Requirements", workbookDiff.requirements],
                              ["Pricing", workbookDiff.pricing],
                              ["Schedule", workbookDiff.schedule],
                              ["Risks", workbookDiff.risks],
                              ["Assumptions", workbookDiff.assumptions],
                            ] as const
                          ).map(([label, diff]) => (
                            <div key={label} className="rounded-md border border-amber-200 bg-white/70 px-2 py-1.5">
                              <p className="font-semibold">{label}</p>
                              <p>Added: {diff.added.length} | Edited: {diff.edited.length} | Removed: {diff.removed.length}</p>
                              {diff.added.length > 0 ? <p className="truncate">+ {diff.added[0]}</p> : null}
                              {diff.edited.length > 0 ? <p className="truncate">~ {diff.edited[0]}</p> : null}
                              {diff.removed.length > 0 ? <p className="truncate">- {diff.removed[0]}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {isExtracting && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center z-20">
                <Loader2 size={48} className="text-indigo-600 animate-spin mb-4" />
                <p className="text-xl font-bold text-gray-900">Extracting content...</p>
                <p className="text-sm text-gray-500 mt-2">Our AI is processing your document</p>
              </div>
            )}
            
            {error && (
              <div className="absolute inset-0 bg-red-50/80 backdrop-blur-md flex flex-col items-center justify-center z-20 p-8">
                <div className="bg-red-100 rounded-full p-4 mb-4">
                  <FileText size={32} className="text-red-600" />
                </div>
                <p className="text-xl font-bold text-red-900 mb-2">Extraction Error</p>
                <p className="text-sm text-red-700 text-center max-w-md">{error}</p>
              </div>
            )}
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-between py-4">
              <button
                onClick={() => setIsPreviewOpen(true)}
                className="h-10 w-10 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                title="Open preview"
              >
                <ChevronRight size={18} className="mx-auto" />
              </button>
              <span className="text-[10px] font-semibold text-slate-400 tracking-wider rotate-180" style={{ writingMode: "vertical-rl" }}>
                PREVIEW
              </span>
              <span className="h-10 w-10" />
            </div>
          )}
        </section>

        {/* Right Section: Editor (The "Block" stuff) */}
        <section className={`${isEditorOpen ? "flex-1" : "w-14"} flex flex-col bg-white border border-slate-200 rounded-2xl min-w-0 overflow-hidden transition-all`}>
          {isEditorOpen ? (
            <>
              <header className="h-16 border-b px-6 bg-white z-10 sticky top-0 flex items-end justify-between">
                <div className="flex items-center gap-5 h-full">
              <button 
                onClick={() => setActiveTab("document")}
                className={`text-sm font-semibold pb-3 border-b-2 transition-all ${activeTab === "document" ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}
              >
                Smart Document
              </button>
              <button 
                onClick={() => setActiveTab("json")}
                className={`text-sm font-semibold pb-3 border-b-2 transition-all ${activeTab === "json" ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}
              >
                Raw JSON
              </button>
                </div>
                <button
                  onClick={() => setIsEditorOpen(false)}
                  className="mb-3 h-9 w-9 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  title="Collapse editor"
                >
                  <ChevronRight size={16} className="mx-auto" />
                </button>
              </header>

              <div className="flex-1 overflow-hidden">
            {(() => {
              const selectedEditorContent =
                editorSourceMode === "relevant"
                  ? relevanceSummary.relevantContent
                  : editorSourceMode === "workbook"
                    ? workbookEditorContent
                  : editorSourceMode === "full"
                    ? extractedContent
                    : "";
              return activeTab === "document" ? (
                selectedEditorContent ? (
                  <Editor initialContent={selectedEditorContent} />
                ) : editorEnabled ? (
                  <Editor initialContent="" />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-400">
                    <FileText size={64} strokeWidth={1} className="mb-4 opacity-20" />
                    <p className="text-lg font-medium">No extraction results yet</p>
                    <p className="text-sm mt-1 mb-4">Upload and extract a file to see the block editor in action</p>
                    <button
                      onClick={handleEnableEditor}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-all text-sm font-semibold shadow-md"
                    >
                      Use Editor Without File
                    </button>
                  </div>
                )
              ) : (
                <div className="h-full bg-slate-950 overflow-auto p-6">
                  <pre className="text-xs leading-6 text-emerald-300 font-mono whitespace-pre-wrap break-words">
                    {jsonResult ? JSON.stringify(jsonResult, null, 2) : "// No JSON data available"}
                  </pre>
                </div>
              );
            })()}
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-between py-4">
              <button
                onClick={() => setIsEditorOpen(true)}
                className="h-10 w-10 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                title="Open editor"
              >
                <ChevronLeft size={18} className="mx-auto" />
              </button>
              <span className="text-[10px] font-semibold text-slate-400 tracking-wider rotate-180" style={{ writingMode: "vertical-rl" }}>
                EDITOR
              </span>
              <span className="h-10 w-10" />
            </div>
          )}
        </section>
      </main>
    </MantineProvider>
  );
}
