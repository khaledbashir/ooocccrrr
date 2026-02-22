import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OcrProvider, ERROR_MESSAGES, FILE_TYPES, UI_STATES } from '@/lib/constants';
import { inferMimeType, parsePdfPageSelection } from '@/lib/utils';
import { extractContent } from '@/lib/ocrService';
import { ApiResponse, ExtractionResponse } from '@/types';
import { PDFDocument } from 'pdf-lib';

export async function POST(req: Request): Promise<NextResponse<ExtractionResponse | { error: string }>> {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const providerInput = (formData.get('provider') as string) ?? 'marker';
    const provider: OcrProvider =
      providerInput === 'mistral'
        ? 'mistral'
        : providerInput === 'ollama_glm_ocr'
          ? 'ollama_glm_ocr'
          : providerInput === 'marker'
            ? 'marker'
            : providerInput === 'docling'
              ? 'docling'
              : 'kreuzberg';

    if (!file) {
      return NextResponse.json({ error: ERROR_MESSAGES.NO_FILE }, { status: 400 });
    }

    const normalizedType = file.type && file.type !== 'application/octet-stream' ? file.type : inferMimeType(file.name);
    const normalizedFile = new File([file], file.name, { type: normalizedType });
    const pageSelectionInput = (formData.get('pageSelection') as string) ?? '';
    let fileForExtraction: File = normalizedFile;

    const trimmedSelection = pageSelectionInput.trim();
    if (trimmedSelection && normalizedType === FILE_TYPES.PDF) {
      const fileBuffer = Buffer.from(await normalizedFile.arrayBuffer());
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const selectionResult = parsePdfPageSelection(trimmedSelection, pdfDoc.getPageCount());
      if ('error' in selectionResult) {
        return NextResponse.json({ error: selectionResult.error }, { status: 400 });
      }

      if (selectionResult.pageNumbers.length > 0) {
        const sequentialAllPages =
          selectionResult.pageNumbers.length === pdfDoc.getPageCount() &&
          selectionResult.pageNumbers.every((page, index) => page === index + 1);
        if (!sequentialAllPages) {
          const subsetPdf = await PDFDocument.create();
          const pages = await subsetPdf.copyPages(
            pdfDoc,
            selectionResult.pageNumbers.map((page) => page - 1),
          );
          pages.forEach((page) => subsetPdf.addPage(page));
          const subsetBytes = await subsetPdf.save();
          fileForExtraction = new File([subsetBytes], file.name, { type: normalizedType });
        }
      }
    }

    const upstream: ApiResponse = await extractContent(fileForExtraction, provider);

    if (!upstream.ok) {
      const upstreamMessage =
        upstream.data && typeof upstream.data === 'object' && 'error' in upstream.data && typeof (upstream.data as { error?: unknown }).error === 'string'
          ? (upstream.data as { error: string }).error
          : `Upstream extract failed with status ${upstream.status}`;

      return NextResponse.json(
        {
          error: upstreamMessage,
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
