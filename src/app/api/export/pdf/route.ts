import { NextResponse } from "next/server";

type ExportPdfRequest = {
  title?: string;
  content?: string;
  filename?: string;
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderContentHtml(content: string): string {
  const chunks = content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (chunks.length === 0) return "<p>No content provided.</p>";

  return chunks
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ExportPdfRequest;
    const content = (body.content || "").trim();
    const title = (body.title || "Document Export").trim() || "Document Export";
    const baseFilename = (body.filename || "document-export").replace(/[^a-zA-Z0-9-_]/g, "_");
    const outputFilename = baseFilename.endsWith(".pdf") ? baseFilename : `${baseFilename}.pdf`;

    if (!content) {
      return NextResponse.json({ error: "No content provided for PDF export." }, { status: 400 });
    }

    const jsreportUrl = (process.env.JSREPORT_URL || "https://basheer-jsreport.prd42b.easypanel.host").replace(/\/$/, "");
    const jsreportUser = process.env.JSREPORT_USER || "admin";
    const jsreportPassword = process.env.JSREPORT_PASSWORD || "admin";
    const authToken = Buffer.from(`${jsreportUser}:${jsreportPassword}`).toString("base64");

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #0f172a;
        margin: 34px 40px;
        line-height: 1.55;
      }
      h1 {
        font-size: 22px;
        margin: 0 0 18px 0;
      }
      p {
        margin: 0 0 14px 0;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    ${renderContentHtml(content)}
  </body>
</html>`;

    const jsreportPayload = {
      template: {
        recipe: "chrome-pdf",
        engine: "none",
        content: html,
        chrome: {
          marginTop: "18mm",
          marginBottom: "18mm",
          marginLeft: "14mm",
          marginRight: "14mm",
          printBackground: true,
        },
      },
    };

    const upstreamResponse = await fetch(`${jsreportUrl}/api/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authToken}`,
      },
      body: JSON.stringify(jsreportPayload),
    });

    if (!upstreamResponse.ok) {
      const rawError = await upstreamResponse.text().catch(() => "");
      return NextResponse.json(
        {
          error: rawError || `jsreport export failed with status ${upstreamResponse.status}.`,
        },
        { status: upstreamResponse.status },
      );
    }

    const pdfBuffer = await upstreamResponse.arrayBuffer();
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outputFilename}"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "PDF export failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
