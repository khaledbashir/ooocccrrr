import { OcrProvider } from '@/lib/constants';

export interface Extraction {
  id: string;
  filename: string;
  content: string;
  createdAt: string;
}

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

export interface ExtractionResponse {
  extraction: Extraction;
  data: any;
}

export interface FileUploadResponse {
  error?: string;
  upstream?: any;
}

export interface HistoryItem {
  id: string;
  filename: string;
  content: string;
  createdAt: string;
}

export interface EditorProps {
  initialContent?: string;
  onChange?: (content: string) => void;
}

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

export interface FileProcessingState {
  file: File | null;
  previewUrl: string | null;
  excelData: string | null;
  isExtracting: boolean;
  extractedContent: string;
  jsonResult: any;
  error: string | null;
}