/**
 * Test script to verify OCR provider response parsing
 * This can be used in development to test different response formats
 */

import { extractDisplayContent } from './utils';
import { extractContentWithFallback, logResponseStructure } from './debugUtils';

// Mock response examples from different providers
const mockResponses = {
  // GLM OCR response examples
  glmString: "This is a simple text response from GLM",
  glmObject: {
    response: "This is GLM response in a response field"
  },
  glmNested: {
    data: {
      text: "This is GLM response nested in data.text"
    }
  },
  
  // Kreuzberg response examples
  kreuzbergMarkdown: {
    markdown: "# Document Title\n\nThis is content from Kreuzberg"
  },
  kreuzbergPages: {
    pages: [
      { content: "Page 1 content from Kreuzberg" },
      { text: "Page 2 content from Kreuzberg" }
    ]
  },
  kreuzbergString: "Plain string response from Kreuzberg",
  
  // Mistral response examples
  mistralStructured: {
    pages: [
      {
        markdown: "# Page 1\nContent from Mistral OCR"
      },
      {
        markdown: "# Page 2\nMore content from Mistral OCR"
      }
    ]
  },
  
  // Edge cases
  emptyResponse: {},
  nullResponse: null,
  arrayResponse: ["Item 1", "Item 2", "Item 3"]
};

export function testResponseParsing() {
  if (process.env.NODE_ENV !== 'development') return;
  
  console.log('\n🧪 TESTING OCR RESPONSE PARSING 🧪\n');
  
  Object.entries(mockResponses).forEach(([name, response]) => {
    console.log(`\n--- Testing ${name} ---`);
    logResponseStructure(name, response);
    
    const content1 = extractDisplayContent(response);
    const content2 = extractContentWithFallback(response);
    
    console.log('extractDisplayContent result:', content1.substring(0, 100) + (content1.length > 100 ? '...' : ''));
    console.log('extractContentWithFallback result:', content2.substring(0, 100) + (content2.length > 100 ? '...' : ''));
    console.log('Results match:', content1 === content2);
  });
  
  console.log('\n🏁 TESTING COMPLETE 🏁\n');
}

// Auto-run in development
if (process.env.NODE_ENV === 'development') {
  // Uncomment to run tests immediately
  // testResponseParsing();
}