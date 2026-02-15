import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const kreuzbergBaseUrl = (process.env.KREUZBERG_URL ?? 'http://localhost:8000').replace(/\/$/, '');

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

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const normalizedType = file.type && file.type !== 'application/octet-stream' ? file.type : inferMimeType(file.name);
    const normalizedFile = new File([file], file.name, { type: normalizedType });

    // Call Kreuzberg API
    const kreuzbergFormData = new FormData();
    // Some Kreuzberg deployments expect `files` while others expect `file`.
    // Send both keys with explicit filename for compatibility.
    kreuzbergFormData.append('file', normalizedFile, normalizedFile.name);
    kreuzbergFormData.append('files', normalizedFile, normalizedFile.name);

    const upstreamResponse = await fetch(`${kreuzbergBaseUrl}/extract`, {
      method: 'POST',
      body: kreuzbergFormData,
    });

    const upstreamText = await upstreamResponse.text();
    let upstreamData: any;

    try {
      upstreamData = JSON.parse(upstreamText);
    } catch {
      upstreamData = upstreamText;
    }

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        {
          error: `Upstream extract failed with status ${upstreamResponse.status}`,
          upstream: upstreamData,
        },
        { status: upstreamResponse.status },
      );
    }

    const extractionData = upstreamData;

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
