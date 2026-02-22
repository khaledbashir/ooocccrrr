import { FILE_TYPES } from './constants';

/**
 * Infers MIME type based on file extension
 */
export function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return FILE_TYPES.PDF;
  if (lower.endsWith('.png')) return FILE_TYPES.PNG;
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return FILE_TYPES.JPEG;
  if (lower.endsWith('.csv')) return FILE_TYPES.CSV;
  if (lower.endsWith('.xlsx')) return FILE_TYPES.XLSX;
  if (lower.endsWith('.xls')) return FILE_TYPES.XLS;
  if (lower.endsWith('.txt')) return FILE_TYPES.TXT;
  if (lower.endsWith('.md')) return FILE_TYPES.MD;
  return FILE_TYPES.OCTET_STREAM;
}

/**
 * Converts ArrayBuffer to data URL
 */
export function toDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

/**
 * Parses upstream response, handling both JSON and text
 */
export async function parseUpstreamResponse(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Normalizes OCR text by cleaning up formatting
 */
export function normalizeOcrText(text: string): string {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (const rawLine of rawLines) {
    const line = rawLine.replace(/[ \t]+$/g, "");
    const trimmed = line.trim();

    if (!trimmed) {
      if (out[out.length - 1] !== "") out.push("");
      continue;
    }

    const isHeadingLike =
      /^#{1,6}\s/.test(trimmed) ||
      /^[A-Z][A-Z0-9 &().,'/-]{6,}$/.test(trimmed) ||
      trimmed.endsWith(":");

    if (isHeadingLike && out.length > 0 && out[out.length - 1] !== "") {
      out.push("");
    }

    out.push(trimmed);

    if (isHeadingLike) {
      out.push("");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Extracts display content from various OCR response formats
 */
export function extractDisplayContent(payload: any): string {
  if (!payload) return "";

  // Handle string responses directly
  if (typeof payload === "string") return normalizeOcrText(payload);

  // Handle array responses
  if (Array.isArray(payload)) {
    return payload
      .map((item) => extractDisplayContent(item))
      .filter(Boolean)
      .join("\n\n");
  }

  // Handle object responses with different structures
  if (typeof payload === "object" && payload) {
    // Priority order for content extraction
    const contentFields = [
      'markdown',    // Preferred format
      'content',     // Alternative content field
      'text',        // Simple text field
      'response',    // GLM response field
      'result',      // Some providers use 'result'
    ];

    // Try to find content in the main object
    for (const field of contentFields) {
      if (typeof payload[field] === "string" && payload[field].trim()) {
        return normalizeOcrText(payload[field]);
      }
    }

    // Handle pages array (common in PDF processing)
    if (Array.isArray(payload.pages) && payload.pages.length > 0) {
      return payload.pages
        .map((page: any) => {
          // Try multiple field names for page content
          const pageContent = page?.markdown ||
                           page?.content ||
                           page?.text ||
                           page?.response ||
                           '';
          return pageContent.trim() ? normalizeOcrText(pageContent) : '';
        })
        .filter(Boolean)
        .join("\n\n---\n\n");
    }

    // Handle nested data structures
    if (payload.data) {
      const nestedContent = extractDisplayContent(payload.data);
      if (nestedContent) return nestedContent;
    }
  }

  // Fallback: try to extract any text from the object
  try {
    const textContent = JSON.stringify(payload).replace(/\\n/g, '\n');
    if (textContent.length > 0 && textContent !== '{}') {
      return normalizeOcrText(textContent);
    }
  } catch {
    // If JSON.stringify fails, return empty string
  }

  return "";
}

/**
 * Checks if a file is an Excel file
 */
export function isExcelFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.xlsx') || 
         filename.toLowerCase().endsWith('.xls') || 
         filename.toLowerCase().endsWith('.csv');
}

/**
 * Checks if a file is an image file
 */
export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Checks if a file is a PDF
 */
export function isPdfFile(mimeType: string, filename: string): boolean {
  return mimeType === FILE_TYPES.PDF || filename.toLowerCase().endsWith('.pdf');
}

type PdfPageSelectionResult =
  | { pageNumbers: number[] }
  | { error: string };

export function parsePdfPageSelection(
  selection: string,
  maxPage: number,
): PdfPageSelectionResult {
  const trimmed = selection.trim();
  if (trimmed === "") {
    return { pageNumbers: [] };
  }

  const tokens = trimmed
    .split(/[;,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { pageNumbers: [] };
  }

  const pageSet = new Set<number>();

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start > end) {
        return { error: `Page range ${token} is invalid; start must be before end.` };
      }
      if (start < 1 || end > maxPage) {
        return { error: `Page ranges must fall between 1 and ${maxPage}.` };
      }
      for (let page = start; page <= end; page += 1) {
        pageSet.add(page);
      }
      continue;
    }

    const singleMatch = token.match(/^(\d+)$/);
    if (singleMatch) {
      const page = Number(singleMatch[1]);
      if (page < 1 || page > maxPage) {
        return { error: `Page numbers must be between 1 and ${maxPage}.` };
      }
      pageSet.add(page);
      continue;
    }

    return { error: `Invalid page selection "${token}". Use numbers or ranges like 2-5.` };
  }

  return { pageNumbers: Array.from(pageSet).sort((a, b) => a - b) };
}
