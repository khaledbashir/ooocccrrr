"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Upload,
  Download,
  History,
  Plus,
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
  CircleOff
} from "lucide-react";
import axios from "axios";
import dynamic from "next/dynamic";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";

import { OcrProvider, API_BASE_URLS } from "@/lib/constants";
import { extractDisplayContent } from "@/lib/utils";
import { useFileProcessor } from "@/hooks/useFileProcessor";
import { usePdfExport } from "@/hooks/usePdfExport";
import { HistoryItem } from "@/types";

// Dynamically import Editor to avoid SSR issues with BlockNote/Mantine
const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });
const PdfHoverPreview = dynamic(() => import("@/components/PdfHoverPreview"), { ssr: false });

type RelevanceLabel = "relevant" | "maybe" | "irrelevant";

type RelevanceChunk = {
  id: string;
  title: string;
  text: string;
  label: RelevanceLabel;
  score: number;
  reason: string;
};

type RelevanceSummary = {
  total: number;
  processed: number;
  progress: number;
  relevant: number;
  maybe: number;
  irrelevant: number;
  chunks: RelevanceChunk[];
  relevantContent: string;
};

type EditorSourceMode = "full" | "relevant" | "blank";

const POSITIVE_KEYWORDS = [
  "stadium",
  "arena",
  "scoreboard",
  "video board",
  "sound system",
  "audio visual",
  "broadcast",
  "network infrastructure",
  "it infrastructure",
  "security system",
  "cctv",
  "access control",
  "low voltage",
  "structured cabling",
  "integration",
  "commissioning",
  "operations technology",
  "av system",
];

const NEGATIVE_KEYWORDS = [
  "plumbing",
  "landscaping",
  "asbestos",
  "roofing only",
  "concrete paving only",
  "elevator maintenance",
  "painting only",
  "janitorial",
  "food service only",
];

function toChunkTitle(text: string, index: number) {
  const heading = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length < 100);
  return heading || `Section ${index + 1}`;
}

function splitIntoChunks(rawText: string) {
  const normalized = rawText.trim();
  if (!normalized) return [];

  if (normalized.includes("\n\n---\n\n")) {
    return normalized
      .split("\n\n---\n\n")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 80);
}

function classifyChunk(text: string) {
  const hay = text.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  for (const keyword of POSITIVE_KEYWORDS) {
    if (hay.includes(keyword)) {
      score += 2;
      reasons.push(`contains "${keyword}"`);
    }
  }
  for (const keyword of NEGATIVE_KEYWORDS) {
    if (hay.includes(keyword)) {
      score -= 2;
      reasons.push(`contains "${keyword}"`);
    }
  }
  if (hay.includes("mandatory") || hay.includes("must")) {
    score += 1;
    reasons.push("includes mandatory language");
  }
  if (hay.includes("deadline") || hay.includes("due date") || hay.includes("submission")) {
    score += 1;
    reasons.push("contains submission/deadline requirements");
  }
  if (hay.includes("addendum") || hay.includes("compliance") || hay.includes("insurance")) {
    score += 1;
    reasons.push("contains risk/compliance terms");
  }

  let label: RelevanceLabel = "irrelevant";
  if (score >= 3) label = "relevant";
  else if (score >= 1) label = "maybe";

  return {
    label,
    score,
    reason: reasons.slice(0, 3).join(", ") || "no strong indicators",
  };
}

export default function Home() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<"document" | "json">("document");
  const [isNavOpen, setIsNavOpen] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(true);
  const [ocrProvider, setOcrProvider] = useState<OcrProvider>("kreuzberg");
  const [editorEnabled, setEditorEnabled] = useState(false);
  const [editorSourceMode, setEditorSourceMode] = useState<EditorSourceMode>("full");
  const [isAnalyzingRelevance, setIsAnalyzingRelevance] = useState(false);
  const [relevanceSummary, setRelevanceSummary] = useState<RelevanceSummary>({
    total: 0,
    processed: 0,
    progress: 0,
    relevant: 0,
    maybe: 0,
    irrelevant: 0,
    chunks: [],
    relevantContent: "",
  });
  
  const {
    file,
    previewUrl,
    excelData,
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
        chunks: [],
        relevantContent: "",
      });
    }
  };

  const handleReset = () => {
    clearFile();
    clearError();
    setEditorEnabled(false);
    setEditorSourceMode("blank");
    setRelevanceSummary({
      total: 0,
      processed: 0,
      progress: 0,
      relevant: 0,
      maybe: 0,
      irrelevant: 0,
      chunks: [],
      relevantContent: "",
    });
  };

  const handleEnableEditor = () => {
    setEditorEnabled(true);
    setEditorSourceMode("blank");
  };

  const runRelevanceAnalysis = useCallback(async (rawText: string) => {
    const parts = splitIntoChunks(rawText);
    if (parts.length === 0) {
      setRelevanceSummary({
        total: 0,
        processed: 0,
        progress: 0,
        relevant: 0,
        maybe: 0,
        irrelevant: 0,
        chunks: [],
        relevantContent: "",
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
      chunks: [],
      relevantContent: "",
    });

    const chunks: RelevanceChunk[] = [];
    let relevant = 0;
    let maybe = 0;
    let irrelevant = 0;

    for (let i = 0; i < parts.length; i += 1) {
      const chunkText = parts[i];
      const scored = classifyChunk(chunkText);
      if (scored.label === "relevant") relevant += 1;
      if (scored.label === "maybe") maybe += 1;
      if (scored.label === "irrelevant") irrelevant += 1;

      chunks.push({
        id: `chunk-${i}`,
        title: toChunkTitle(chunkText, i),
        text: chunkText,
        label: scored.label,
        score: scored.score,
        reason: scored.reason,
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
      chunks,
      relevantContent,
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
                <button
                  onClick={handleReset}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white py-2.5 px-4 rounded-xl hover:bg-red-700 transition-all shadow-sm font-medium"
                >
                  <Plus size={18} />
                  Reset All
                </button>
                <button
                  onClick={() => setIsNavOpen(false)}
                  className="h-10 w-10 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
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
                  {previewUrl && file.type === "application/pdf" ? (
                    <PdfHoverPreview fileUrl={previewUrl} />
                  ) : previewUrl ? (
                    <img src={previewUrl} alt="Preview" className="max-w-full max-h-full object-contain p-4 shadow-2xl" />
                  ) : excelData ? (
                    <div className="w-full h-full bg-white overflow-auto p-6 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: excelData }} />
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
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
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
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
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
                              <p className="text-[11px] text-slate-500 truncate">{chunk.reason}</p>
                            </div>
                          ))}
                      </div>
                    )}
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
