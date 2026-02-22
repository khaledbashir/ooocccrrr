import { useState, useCallback } from 'react';
import { OcrProvider, ERROR_MESSAGES } from '@/lib/constants';
import { isExcelFile, isImageFile, isPdfFile, extractDisplayContent } from '@/lib/utils';
import { FileProcessingState, HistoryItem } from '@/types';

export type ExtractionMode = 'rfp_workflow' | 'ocr_all';
export type ExcelExtractionScope = 'all' | 'active';

async function parseJsonSafely(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || `Request failed with status ${response.status}` };
  }
}

function normalizeErrorMessage(message: string): string {
  if (/<(?:!doctype|html|head|body)\b/i.test(message)) {
    return 'Upstream OCR service returned an HTML error page. Verify the provider URL and ensure the service is running.';
  }
  return message;
}

type ExcelExtractionOptions = {
  scope?: ExcelExtractionScope;
  selectedSheetName?: string;
};

async function parseExcelWorkbook(file: File, options: ExcelExtractionOptions = {}) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array' });
  const scope = options.scope ?? 'all';

  const allSheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet?.['!ref'];
    const decodedRange = ref ? XLSX.utils.decode_range(ref) : null;
    const rowCount = decodedRange ? decodedRange.e.r + 1 : 0;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    return {
      name: sheetName,
      html: XLSX.utils.sheet_to_html(sheet),
      csv,
      rowCount,
    };
  });

  const scopedSheets =
    scope === 'active' && options.selectedSheetName
      ? allSheets.filter((sheet) => sheet.name === options.selectedSheetName)
      : allSheets;
  const extractedSheets = scopedSheets.length > 0 ? scopedSheets : allSheets.slice(0, 1);
  const defaultPreviewSheet =
    (options.selectedSheetName && allSheets.find((sheet) => sheet.name === options.selectedSheetName)) || allSheets[0];
  const firstSheetHtml = defaultPreviewSheet?.html || null;

  const markdownSections = extractedSheets.map((sheet) => {
    const content = sheet.csv || '(empty sheet)';
    return `## Sheet: ${sheet.name}\n\n\`\`\`csv\n${content}\n\`\`\``;
  });

  return {
    excelData: firstSheetHtml,
    excelSheets: allSheets.map((sheet) => ({
      name: sheet.name,
      html: sheet.html,
      rowCount: sheet.rowCount,
    })),
    extractedText: `# Workbook: ${file.name}\n\n${markdownSections.join('\n\n')}`,
    jsonResult: {
      provider: 'local_excel_parser',
      mode: scope === 'active' ? 'single_worksheet' : 'all_worksheets',
      selectedSheet: scope === 'active' ? options.selectedSheetName || extractedSheets[0]?.name || null : null,
      workbook: file.name,
      sheets: extractedSheets.map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rowCount,
        csv: sheet.csv,
      })),
    },
  };
}

export type ExtractionOptions = ExcelExtractionOptions & {
  pageSelection?: string;
};

export function useFileProcessor() {
  const [state, setState] = useState<FileProcessingState>({
    file: null,
    previewUrl: null,
    excelData: null,
    excelSheets: [],
    isExtracting: false,
    extractedContent: '',
    jsonResult: null,
    error: null,
  });

  const processFile = useCallback((selectedFile: File) => {
    setState(prev => ({
      ...prev,
      file: selectedFile,
      extractedContent: '',
      jsonResult: null,
      error: null,
    }));

    // Create preview
    if (isImageFile(selectedFile.type) || isPdfFile(selectedFile.type, selectedFile.name)) {
      const url = URL.createObjectURL(selectedFile);
      setState(prev => ({
        ...prev,
        previewUrl: url,
        excelData: null,
        excelSheets: [],
      }));
    } else if (isExcelFile(selectedFile.name)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        import('xlsx').then(XLSX => {
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const html = XLSX.utils.sheet_to_html(worksheet);
          const excelSheets = workbook.SheetNames.map((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const ref = sheet["!ref"];
            const rowCount = ref ? XLSX.utils.decode_range(ref).e.r : 0;
            return {
              name: sheetName,
              html: XLSX.utils.sheet_to_html(sheet),
              rowCount,
            };
          });
          setState(prev => ({
            ...prev,
            excelData: html,
            excelSheets,
            previewUrl: null,
          }));
        });
      };
      reader.readAsArrayBuffer(selectedFile);
    } else {
      setState(prev => ({
        ...prev,
        previewUrl: null,
        excelData: null,
        excelSheets: [],
      }));
    }
  }, []);

  const extractContent = useCallback(
    async (
      ocrProvider: OcrProvider,
      _mode: ExtractionMode = 'rfp_workflow',
      options: ExtractionOptions = {},
      fileOverride?: File,
    ) => {
    const targetFile = fileOverride || state.file;
    if (!targetFile) return null;
    const isExcel = isExcelFile(targetFile.name);

    if (isExcel) {
      try {
        setState(prev => ({ ...prev, isExtracting: true, error: null }));
        const { pageSelection, ...excelOptions } = options;
        const excelExtraction = await parseExcelWorkbook(targetFile, excelOptions);
        setState(prev => ({
          ...prev,
          file: targetFile,
          excelData: excelExtraction.excelData,
          excelSheets: excelExtraction.excelSheets,
          jsonResult: excelExtraction.jsonResult,
          extractedContent: excelExtraction.extractedText,
          isExtracting: false,
        }));
        return excelExtraction.extractedText;
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : ERROR_MESSAGES.UPSTREAM_REQUEST_FAILED;
        setState(prev => ({
          ...prev,
          error: normalizeErrorMessage(errorMessage),
          isExtracting: false,
        }));
        return null;
      }
    }

    const isImage = isImageFile(targetFile.type);

    if (ocrProvider === 'ollama_glm_ocr' && !isImage) {
      setState(prev => ({
        ...prev,
        error: ERROR_MESSAGES.PDF_ONLY_FOR_IMAGES,
      }));
      return null;
    }

    setState(prev => ({ ...prev, isExtracting: true, error: null }));
    
    const formData = new FormData();
        formData.append('file', targetFile);
        formData.append('provider', ocrProvider);
        if (options.pageSelection) {
          formData.append('pageSelection', options.pageSelection);
        }

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await parseJsonSafely(response);
        // Handle specific error cases
        if (errorData.error && errorData.error.includes('Unsupported file type')) {
          throw new Error(ERROR_MESSAGES.UNSUPPORTED_FILE_TYPE);
        }
        throw new Error(normalizeErrorMessage(errorData.error || 'Extraction failed'));
      }
      
      const data = await parseJsonSafely(response);
      if (!data || typeof data !== 'object' || !('data' in data)) {
        throw new Error('Invalid API response format');
      }
      const extractedText = extractDisplayContent(data.data);
      setState(prev => ({
        ...prev,
        file: targetFile,
        jsonResult: data.data,
        extractedContent: extractedText,
        isExtracting: false,
      }));
      return extractedText;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : ERROR_MESSAGES.UPSTREAM_REQUEST_FAILED;
      console.error('Extraction failed', error);
      setState(prev => ({
        ...prev,
        error: normalizeErrorMessage(errorMessage),
        isExtracting: false,
      }));
      return null;
    }
  }, [state.file]);

  const clearFile = useCallback(() => {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
    }
    setState({
      file: null,
      previewUrl: null,
      excelData: null,
      excelSheets: [],
      isExtracting: false,
      extractedContent: '',
      jsonResult: null,
      error: null,
    });
  }, [state.previewUrl]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const setHistoryItem = useCallback((item: HistoryItem) => {
    const data = JSON.parse(item.content);
    setState(prev => ({
      ...prev,
      jsonResult: data,
      file: { name: item.filename } as File,
      extractedContent: extractDisplayContent(data),
    }));
  }, []);

  return {
    ...state,
    processFile,
    extractContent,
    clearFile,
    clearError,
    setHistoryItem,
  };
}
