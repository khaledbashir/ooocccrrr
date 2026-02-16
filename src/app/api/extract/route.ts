import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OcrProvider, ERROR_MESSAGES, UI_STATES } from '@/lib/constants';
import { inferMimeType } from '@/lib/utils';
import { extractContent } from '@/lib/ocrService';
import { ApiResponse, ExtractionResponse } from '@/types';

export async function POST(req: Request): Promise<NextResponse<ExtractionResponse | { error: string }>> {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const providerInput = (formData.get('provider') as string) ?? 'kreuzberg';
    const provider: OcrProvider =
      providerInput === 'mistral'
        ? 'mistral'
        : providerInput === 'ollama_glm_ocr'
          ? 'ollama_glm_ocr'
          : 'kreuzberg';

    if (!file) {
      return NextResponse.json({ error: ERROR_MESSAGES.NO_FILE }, { status: 400 });
    }

    const normalizedType = file.type && file.type !== 'application/octet-stream' ? file.type : inferMimeType(file.name);
    const normalizedFile = new File([file], file.name, { type: normalizedType });

    const upstream: ApiResponse = await extractContent(normalizedFile, provider);

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

    // Convert Date to string for response
    const responseExtraction = {
      ...extraction,
      createdAt: extraction.createdAt.toISOString(),
    };

    return NextResponse.json({ extraction: responseExtraction, data: extractionData });
  } catch (error: unknown) {
    console.error('Extraction error:', error);
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.UPSTREAM_REQUEST_FAILED;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const extractions = await prisma.extraction.findMany({
      orderBy: { createdAt: 'desc' },
      take: UI_STATES.HISTORY_LIMIT,
    });
    return NextResponse.json(extractions);
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.FAILED_TO_FETCH_EXTRACTS }, { status: 500 });
  }
}
