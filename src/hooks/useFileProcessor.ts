import { useState, useCallback } from 'react';
import { OcrProvider, ERROR_MESSAGES } from '@/lib/constants';
import { isExcelFile, isImageFile, isPdfFile, extractDisplayContent } from '@/lib/utils';
import { FileProcessingState, HistoryItem } from '@/types';

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

export function useFileProcessor() {
  const [state, setState] = useState<FileProcessingState>({
    file: null,
    previewUrl: null,
    excelData: null,
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
          setState(prev => ({
            ...prev,
            excelData: html,
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
      }));
    }
  }, []);

  const extractContent = useCallback(async (ocrProvider: OcrProvider) => {
    if (!state.file) return;

    const isImage = isImageFile(state.file.type);

    if (ocrProvider === 'ollama_glm_ocr' && !isImage) {
      setState(prev => ({
        ...prev,
        error: ERROR_MESSAGES.PDF_ONLY_FOR_IMAGES,
      }));
      return;
    }

    setState(prev => ({ ...prev, isExtracting: true, error: null }));
    
    const formData = new FormData();
    formData.append('file', state.file);
    formData.append('provider', ocrProvider);

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
      setState(prev => ({
        ...prev,
        jsonResult: data.data,
        extractedContent: extractDisplayContent(data.data),
        isExtracting: false,
      }));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : ERROR_MESSAGES.UPSTREAM_REQUEST_FAILED;
      console.error('Extraction failed', error);
      setState(prev => ({
        ...prev,
        error: normalizeErrorMessage(errorMessage),
        isExtracting: false,
      }));
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
