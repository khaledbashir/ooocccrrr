import { OcrProvider, API_BASE_URLS, OCR_MODELS, ERROR_MESSAGES } from './constants';
import { inferMimeType, toDataUrl, parseUpstreamResponse, isImageFile } from './utils';
import { logResponseStructure, extractContentWithFallback } from './debugUtils';

type ApiResponse<T = any> = {
  ok: boolean;
  status: number;
  data: T;
};

// Debug logging function
function debugLog(provider: OcrProvider, message: string, data?: any) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${provider.toUpperCase()} OCR] ${message}`, data || '');
  }
}

function mapFetchFailure(error: unknown, provider: OcrProvider, baseUrl: string): ApiResponse {
  let code: string | undefined;
  if (typeof error === 'object' && error && 'cause' in error) {
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause === 'object' && cause && 'code' in cause && typeof (cause as { code?: unknown }).code === 'string') {
      code = (cause as { code: string }).code;
    }
  }
  
  const baseMessage =
    provider === 'ollama_glm_ocr'
      ? `Cannot connect to Ollama at ${baseUrl}. Start Ollama and ensure model "${OCR_MODELS.ollamaGlm}" is installed.`
      : provider === 'kreuzberg'
        ? `Cannot connect to Kreuzberg at ${baseUrl}.`
        : `Cannot connect to Mistral API at ${baseUrl}.`;

  return {
    ok: false,
    status: 503,
    data: {
      error: baseMessage,
      code,
      details: error instanceof Error ? error.message : 'Upstream request failed',
    },
  };
}

async function extractWithKreuzberg(file: File): Promise<ApiResponse> {
  debugLog('kreuzberg', `Starting extraction for file: ${file.name} (${file.type})`);
  
  const kreuzbergFormData = new FormData();
  kreuzbergFormData.append('file', file, file.name);
  kreuzbergFormData.append('files', file, file.name);
  
  // Add improved configuration options based on best practices
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = isImageFile(file.type);
  
  // Configure extraction options based on file type
  if (isPdf) {
    kreuzbergFormData.append('extract_tables', 'true');
    kreuzbergFormData.append('preserve_layout', 'true');
    kreuzbergFormData.append('output_format', 'markdown');
  } else if (isImage) {
    kreuzbergFormData.append('enhance_image', 'true');
    kreuzbergFormData.append('extract_tables', 'true');
    kreuzbergFormData.append('output_format', 'markdown');
  }

  let response: Response;
  try {
    debugLog('kreuzberg', `Sending request to: ${API_BASE_URLS.kreuzberg}/extract`);
    debugLog('kreuzberg', `File type: ${file.type}, isPdf: ${isPdf}, isImage: ${isImage}`);
    
    response = await fetch(`${API_BASE_URLS.kreuzberg}/extract`, {
      method: 'POST',
      body: kreuzbergFormData,
    });
    debugLog('kreuzberg', `Response status: ${response.status} ${response.statusText}`);
  } catch (error) {
    debugLog('kreuzberg', 'Request failed', error);
    return mapFetchFailure(error, 'kreuzberg', API_BASE_URLS.kreuzberg);
  }

  const data = await parseUpstreamResponse(response);
  debugLog('kreuzberg', 'Raw response data', data);
  logResponseStructure('kreuzberg', data);

  // Ensure Kreuzberg response has a consistent structure
  const extractedMarkdown = extractContentWithFallback(data);
  
  const processedData = {
    ...data,
    provider: 'kreuzberg',
    markdown: extractedMarkdown
  };

  debugLog('kreuzberg', 'Processed data', processedData);

  return {
    ok: response.ok,
    status: response.status,
    data: processedData,
  };
}

async function extractWithOllamaGlm(file: File): Promise<ApiResponse> {
  const mimeType = file.type || inferMimeType(file.name);
  debugLog('ollama_glm_ocr', `Starting extraction for file: ${file.name} (${mimeType})`);

  if (!isImageFile(mimeType)) {
    debugLog('ollama_glm_ocr', `Unsupported file type: ${mimeType}`);
    return {
      ok: false,
      status: 400,
      data: {
        error: ERROR_MESSAGES.UNSUPPORTED_FILE_TYPE,
      },
    };
  }

  const base64Image = Buffer.from(await file.arrayBuffer()).toString('base64');
  debugLog('ollama_glm_ocr', `Base64 image length: ${base64Image.length}`);

  let response: Response;
  try {
    // Enhanced prompt for better formatting based on successful examples
    const enhancedPrompt = `Extract all text from this image and format it as structured markdown.

Rules:
- Preserve the original layout and structure
- Use proper markdown formatting (headers, lists, tables)
- For tables: create proper markdown tables with | separators
- For text blocks: preserve paragraphs with double line breaks
- For headings: use # ## ### based on hierarchy
- For lists: use - or * for bullet points, 1. 2. for numbered lists
- Maintain column alignment for tabular data
- Include ALL visible text, even small print
- Do not add any explanations or notes outside the extracted content

Return ONLY the markdown-formatted text without any additional commentary.`;

    const requestBody = {
      model: OCR_MODELS.ollamaGlm,
      prompt: enhancedPrompt,
      images: [base64Image],
      stream: false,
      options: {
        temperature: 0.1, // Slightly higher for better formatting decisions
        top_p: 0.9,
        repeat_penalty: 1.1,
      },
    };
    
    debugLog('ollama_glm_ocr', `Sending request to: ${API_BASE_URLS.ollama}/api/generate`);
    debugLog('ollama_glm_ocr', 'Request body (without images)', { ...requestBody, images: '[BASE64_DATA]' });
    
    response = await fetch(`${API_BASE_URLS.ollama}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    debugLog('ollama_glm_ocr', `Response status: ${response.status} ${response.statusText}`);
  } catch (error) {
    debugLog('ollama_glm_ocr', 'Request failed', error);
    return mapFetchFailure(error, 'ollama_glm_ocr', API_BASE_URLS.ollama);
  }

  const data = await parseUpstreamResponse(response);
  debugLog('ollama_glm_ocr', 'Raw response data', data);
  logResponseStructure('ollama_glm_ocr', data);
  
  // Use the fallback extraction method
  const extractedMarkdown = extractContentWithFallback(data);

  const processedData = {
    markdown: extractedMarkdown,
    raw: data,
    model: OCR_MODELS.ollamaGlm,
    provider: 'ollama_glm_ocr',
  };

  debugLog('ollama_glm_ocr', 'Processed data', processedData);

  return {
    ok: response.ok,
    status: response.status,
    data: processedData,
  };
}

async function extractWithMistral(file: File): Promise<ApiResponse> {
  const apiKey = process.env.MISTRAL_API_KEY;
  debugLog('mistral', `Starting extraction for file: ${file.name} (${file.type})`);

  if (!apiKey) {
    debugLog('mistral', 'Missing API key');
    throw new Error(ERROR_MESSAGES.MISSING_API_KEY);
  }

  const dataUrl = toDataUrl(await file.arrayBuffer(), file.type || inferMimeType(file.name));
  const isImage = isImageFile(file.type || '');
  debugLog('mistral', `File is image: ${isImage}, data URL length: ${dataUrl.length}`);

  const payload = isImage
    ? {
        model: OCR_MODELS.mistral,
        document: {
          type: 'image_url',
          image_url: dataUrl,
        },
        include_image_base64: true,
      }
    : {
        model: OCR_MODELS.mistral,
        document: {
          type: 'document_url',
          document_url: dataUrl,
        },
        table_format: 'html',
        include_image_base64: true,
      };

  let response: Response;
  try {
    debugLog('mistral', `Sending request to: ${API_BASE_URLS.mistral}/v1/ocr`);
    debugLog('mistral', 'Request payload (without data URL)', { ...payload, document: payload.document ? { ...payload.document, image_url: '[DATA_URL]', document_url: '[DATA_URL]' } : null });
    
    response = await fetch(`${API_BASE_URLS.mistral}/v1/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    debugLog('mistral', `Response status: ${response.status} ${response.statusText}`);
  } catch (error) {
    debugLog('mistral', 'Request failed', error);
    return mapFetchFailure(error, 'mistral', API_BASE_URLS.mistral);
  }

  const data = await parseUpstreamResponse(response);
  debugLog('mistral', 'Response data', data);
  logResponseStructure('mistral', data);

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function extractContent(file: File, provider: OcrProvider): Promise<ApiResponse> {
  switch (provider) {
    case 'mistral':
      return await extractWithMistral(file);
    case 'ollama_glm_ocr':
      return await extractWithOllamaGlm(file);
    case 'kreuzberg':
    default:
      return await extractWithKreuzberg(file);
  }
}