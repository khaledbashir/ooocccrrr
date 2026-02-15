import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const kreuzbergBaseUrl = (process.env.KREUZBERG_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const mistralApiBaseUrl = (process.env.MISTRAL_API_BASE_URL ?? 'https://api.mistral.ai').replace(/\/$/, '');
const mistralModel = process.env.MISTRAL_OCR_MODEL ?? 'mistral-ocr-latest';

type OcrProvider = 'kreuzberg' | 'mistral';

function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md')) return 'text/markdown';
  return 'application/octet-stream';
}

function toDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

async function parseUpstreamResponse(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function extractWithKreuzberg(file: File) {
  const kreuzbergFormData = new FormData();
  kreuzbergFormData.append('file', file, file.name);
  kreuzbergFormData.append('files', file, file.name);

  const response = await fetch(`${kreuzbergBaseUrl}/extract`, {
    method: 'POST',
    body: kreuzbergFormData,
  });

  const data = await parseUpstreamResponse(response);

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function extractWithMistral(file: File) {
  const apiKey = process.env.MISTRAL_API_KEY;

  if (!apiKey) {
    throw new Error('Missing MISTRAL_API_KEY');
  }

  const dataUrl = toDataUrl(await file.arrayBuffer(), file.type || inferMimeType(file.name));
  const isImage = (file.type || '').startsWith('image/');

  const payload = isImage
    ? {
        model: mistralModel,
        document: {
          type: 'image_url',
          image_url: dataUrl,
        },
        include_image_base64: true,
      }
    : {
        model: mistralModel,
        document: {
          type: 'document_url',
          document_url: dataUrl,
        },
        table_format: 'html',
        include_image_base64: true,
      };

  const response = await fetch(`${mistralApiBaseUrl}/v1/ocr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await parseUpstreamResponse(response);

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const providerInput = (formData.get('provider') as string) ?? 'kreuzberg';
    const provider: OcrProvider = providerInput === 'mistral' ? 'mistral' : 'kreuzberg';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const normalizedType = file.type && file.type !== 'application/octet-stream' ? file.type : inferMimeType(file.name);
    const normalizedFile = new File([file], file.name, { type: normalizedType });

    const upstream = provider === 'mistral'
      ? await extractWithMistral(normalizedFile)
      : await extractWithKreuzberg(normalizedFile);

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: `Upstream extract failed with status ${upstream.status}`,
          provider,
          upstream: upstream.data,
        },
        { status: upstream.status },
      );
    }

    const extractionData = upstream.data;

    // Save to database
    const extraction = await prisma.extraction.create({
      data: {
        filename: file.name,
        content: JSON.stringify(extractionData),
      },
    });

    return NextResponse.json({ extraction, data: extractionData });
  } catch (error: any) {
    console.error('Extraction error:', error);

    return NextResponse.json({ error: error?.message ?? 'Failed to extract content' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const extractions = await prisma.extraction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return NextResponse.json(extractions);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch extractions' }, { status: 500 });
  }
}
