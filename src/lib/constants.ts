// OCR Provider Configuration
export const OCR_PROVIDERS = {
  OLLAMA_GLM_OCR: 'ollama_glm_ocr',
  KREUZBERG: 'kreuzberg',
  MISTRAL: 'mistral',
  MARKER: 'marker',
  DOCLING: 'docling',
} as const;

export type OcrProvider = typeof OCR_PROVIDERS[keyof typeof OCR_PROVIDERS];

// API Base URLs
export const API_BASE_URLS = {
  kreuzberg: (process.env.KREUZBERG_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
  mistral: (process.env.MISTRAL_API_BASE_URL ?? 'https://api.mistral.ai').replace(/\/$/, ''),
  ollama: (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, ''),
  marker: (process.env.MARKER_URL ?? 'https://basheer-marker.prd42b.easypanel.host').replace(/\/$/, ''),
  docling: (process.env.DOCLING_URL ?? 'https://basheer-docling.prd42b.easypanel.host').replace(/\/$/, ''),
} as const;

// Model Configuration
export const OCR_MODELS = {
  mistral: process.env.MISTRAL_OCR_MODEL ?? 'mistral-ocr-latest',
  ollamaGlm: process.env.OLLAMA_GLM_OCR_MODEL ?? 'glm-ocr:latest',
  marker: process.env.MARKER_MODEL ?? 'default',
  docling: process.env.DOCLING_MODEL ?? 'default',
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  NO_FILE: 'No file provided',
  MISSING_API_KEY: 'Missing MISTRAL_API_KEY',
  UNSUPPORTED_FILE_TYPE: 'GLM-OCR via Ollama currently supports image files in this app. Use Mistral/Kreuzberg/Marker/Docling for PDFs.',
  PDF_ONLY_FOR_IMAGES: 'GLM-OCR in this app currently supports images only. Use Kreuzberg, Mistral, Marker, or Docling for PDF files.',
  MARKER_UNAVAILABLE: 'Cannot connect to Marker service. Ensure Marker is running and configured.',
  DOCLING_UNAVAILABLE: 'Cannot connect to Docling service. Ensure Docling is running and configured.',
  UPSTREAM_REQUEST_FAILED: 'Failed to extract content',
  FAILED_TO_FETCH_EXTRACTS: 'Failed to fetch extractions',
} as const;

// File Type Constants
export const FILE_TYPES = {
  PDF: 'application/pdf',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  CSV: 'text/csv',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  XLS: 'application/vnd.ms-excel',
  TXT: 'text/plain',
  MD: 'text/markdown',
  OCTET_STREAM: 'application/octet-stream',
} as const;

// UI Constants
export const UI_STATES = {
  DEFAULT_SCALE: 1.2,
  MIN_SCALE: 0.8,
  MAX_SCALE: 2.4,
  SCALE_STEP: 0.1,
  HISTORY_LIMIT: 20,
  PDF_EXPORT_SCALE: 2,
} as const;