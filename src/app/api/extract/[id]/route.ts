import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as {
      filename?: string;
      content?: string;
    };

    const filename = typeof body.filename === "string" ? body.filename.trim() : undefined;
    const content = typeof body.content === "string" ? body.content : undefined;

    if (!filename && typeof content === "undefined") {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const updated = await prisma.extraction.update({
      where: { id },
      data: {
        ...(filename ? { filename } : {}),
        ...(typeof content !== "undefined" ? { content } : {}),
      },
    });

    return NextResponse.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "Failed to update extraction." }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await prisma.extraction.delete({
      where: { id },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete extraction." }, { status: 500 });
  }
}
