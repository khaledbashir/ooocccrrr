/**
 * Utility functions for debugging OCR responses
 */

export function logResponseStructure(provider: string, data: any): void {
  if (process.env.NODE_ENV !== 'development') return;
  
  console.log(`\n=== ${provider.toUpperCase()} RESPONSE STRUCTURE ===`);
  
  if (typeof data === 'string') {
    console.log('Type: string');
    console.log('Length:', data.length);
    console.log('Preview:', data.substring(0, 200) + (data.length > 200 ? '...' : ''));
  } else if (Array.isArray(data)) {
    console.log('Type: array');
    console.log('Length:', data.length);
    if (data.length > 0) {
      console.log('First item structure:', Object.keys(data[0] || {}));
    }
  } else if (typeof data === 'object' && data !== null) {
    console.log('Type: object');
    console.log('Keys:', Object.keys(data));
    
    // Look for common content fields
    const contentFields = ['markdown', 'content', 'text', 'response', 'result', 'data'];
    contentFields.forEach(field => {
      if (field in data) {
        const value = data[field];
        console.log(`${field}:`, typeof value, Array.isArray(value) ? `array[${value.length}]` : value?.substring?.(0, 100) + (value?.length > 100 ? '...' : ''));
      }
    });
    
    // Check for pages array
    if ('pages' in data && Array.isArray(data.pages)) {
      console.log('Pages array length:', data.pages.length);
      if (data.pages.length > 0) {
        console.log('First page keys:', Object.keys(data.pages[0] || {}));
      }
    }
  } else {
    console.log('Type:', typeof data);
    console.log('Value:', data);
  }
  
  console.log('=== END RESPONSE STRUCTURE ===\n');
}

export function extractContentWithFallback(data: any): string {
  // Try to extract content in order of preference
  if (typeof data === 'string') {
    return data.trim();
  }
  
  if (typeof data === 'object' && data !== null) {
    // Direct content fields
    const directFields = ['markdown', 'content', 'text', 'response', 'result'];
    for (const field of directFields) {
      if (typeof data[field] === 'string' && data[field].trim()) {
        return data[field].trim();
      }
    }
    
    // Pages array
    if (Array.isArray(data.pages) && data.pages.length > 0) {
      const pageContents = data.pages.map((page: any) => {
        const pageFields = ['markdown', 'content', 'text', 'response'];
        for (const field of pageFields) {
          if (typeof page[field] === 'string' && page[field].trim()) {
            return page[field].trim();
          }
        }
        return '';
      }).filter(Boolean);
      
      if (pageContents.length > 0) {
        return pageContents.join('\n\n---\n\n');
      }
    }
    
    // Nested data
    if (data.data) {
      const nestedContent = extractContentWithFallback(data.data);
      if (nestedContent) return nestedContent;
    }
  }
  
  // Last resort: try to stringify and extract text
  try {
    const stringified = JSON.stringify(data);
    if (stringified && stringified !== '{}') {
      return stringified;
    }
  } catch {
    // Ignore stringify errors
  }
  
  return '';
}