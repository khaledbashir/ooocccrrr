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

export interface BrochureSpecColumnSelection {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  textSample: string[];
  detectionSource: "pdf_text";
}

export interface BrochurePageReference {
  brochureId: string;
  brochureName: string;
  pageNumber: number;
  specColumn?: BrochureSpecColumnSelection | null;
  updatedAt: string;
}

export interface ProposalBrochureAttachment {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  type: string;
  file?: File;
  url?: string;
}

export interface FileProcessingState {
  file: File | null;
  previewUrl: string | null;
  excelData: string | null;
  excelSheets: Array<{
    name: string;
    html: string;
    rowCount: number;
  }>;
  isExtracting: boolean;
  extractedContent: string;
  jsonResult: any;
  error: string | null;
}
