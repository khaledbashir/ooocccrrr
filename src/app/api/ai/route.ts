import { NextResponse } from "next/server";

type AiAction = "summarize" | "improve" | "expand" | "custom";
type AiProvider = "z-ai" | "nvidia" | "groq";

type AiRequestBody = {
  action?: AiAction;
  text?: string;
  provider?: AiProvider;
  model?: string;
  instruction?: string;
  webSearchQuery?: string;
};

const ACTION_PROMPTS: Record<AiAction, string> = {
  summarize:
    "Summarize the content while preserving key numbers, names, and technical facts. Return concise markdown.",
  improve:
    "Improve clarity, grammar, and structure while preserving meaning. Return polished markdown.",
  expand:
    "Expand the content with useful details and better structure while staying faithful to the original. Return markdown.",
  custom:
    "Follow the user's instruction exactly while preserving factual details unless explicitly asked to transform them.",
};

function buildUserPrompt(action: AiAction, text: string, instruction?: string): string {
  if (action === "custom") {
    const command = (instruction || "").trim();
    return `User instruction:\n${command}\n\nDocument:\n${text}`;
  }

  return `${ACTION_PROMPTS[action]}\n\nDocument:\n${text}`;
}

async function fetchWebContext(query: string): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return "";

  const snippets: string[] = [];
  const serperKey = process.env.SERPER_API_KEY;

  if (serperKey) {
    try {
      const serperResponse = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": serperKey,
        },
        body: JSON.stringify({
          q: trimmed,
          num: 5,
        }),
      });

      const serperData = (await serperResponse.json().catch(() => ({}))) as {
        answerBox?: { answer?: string; snippet?: string };
        organic?: Array<{ title?: string; snippet?: string; link?: string }>;
      };

      if (typeof serperData.answerBox?.answer === "string" && serperData.answerBox.answer.trim()) {
        snippets.push(`Answer: ${serperData.answerBox.answer.trim()}`);
      } else if (typeof serperData.answerBox?.snippet === "string" && serperData.answerBox.snippet.trim()) {
        snippets.push(`Answer snippet: ${serperData.answerBox.snippet.trim()}`);
      }

      if (Array.isArray(serperData.organic)) {
        for (const item of serperData.organic.slice(0, 5)) {
          const title = item.title?.trim();
          const snippet = item.snippet?.trim();
          const link = item.link?.trim();
          if (title || snippet) {
            snippets.push(`Result: ${title || "Untitled"}${snippet ? ` - ${snippet}` : ""}${link ? ` (${link})` : ""}`);
          }
        }
      }

      if (snippets.length > 0) {
        return snippets.slice(0, 6).join("\n");
      }
    } catch {
      // Fall through to public fallback sources below.
    }
  }

  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmed)}&format=json&no_html=1&skip_disambig=1`;
    const ddgResponse = await fetch(ddgUrl);
    const ddgData = (await ddgResponse.json().catch(() => ({}))) as {
      AbstractText?: string;
      RelatedTopics?: Array<{ Text?: string }>;
    };

    if (typeof ddgData.AbstractText === "string" && ddgData.AbstractText.trim()) {
      snippets.push(`DuckDuckGo summary: ${ddgData.AbstractText.trim()}`);
    }

    if (Array.isArray(ddgData.RelatedTopics)) {
      for (const item of ddgData.RelatedTopics) {
        if (typeof item?.Text === "string" && item.Text.trim()) {
          snippets.push(`DuckDuckGo related: ${item.Text.trim()}`);
        }
        if (snippets.length >= 4) break;
      }
    }
  } catch {
    // Best-effort enrichment only.
  }

  try {
    const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(trimmed)}&limit=3&namespace=0&format=json`;
    const wikiSearchResponse = await fetch(wikiSearchUrl);
    const wikiSearchData = (await wikiSearchResponse.json().catch(() => [])) as unknown[];

    const titles = Array.isArray(wikiSearchData[1])
      ? (wikiSearchData[1] as unknown[])
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .slice(0, 2)
      : [];

    for (const title of titles) {
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryResponse = await fetch(summaryUrl);
      const summaryData = (await summaryResponse.json().catch(() => ({}))) as {
        title?: string;
        extract?: string;
      };
      if (typeof summaryData.extract === "string" && summaryData.extract.trim()) {
        snippets.push(`Wikipedia (${summaryData.title || title}): ${summaryData.extract.trim()}`);
      }
    }
  } catch {
    // Best-effort enrichment only.
  }

  return snippets.slice(0, 6).join("\n");
}

type ProviderConfig = {
  keyEnv: string;
  baseUrlEnv: string;
  defaultBaseUrl: string;
  modelEnv: string;
  defaultModel: string;
};

const PROVIDERS: Record<AiProvider, ProviderConfig> = {
  "z-ai": {
    keyEnv: "ZAI_API_KEY",
    baseUrlEnv: "ZAI_API_BASE_URL",
    defaultBaseUrl: "https://api.z.ai/api/coding/paas/v4",
    modelEnv: "ZAI_MODEL",
    defaultModel: "glm-4.5",
  },
  nvidia: {
    keyEnv: "NVIDIA_API_KEY",
    baseUrlEnv: "NVIDIA_API_BASE_URL",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    modelEnv: "NVIDIA_MODEL",
    defaultModel: "meta/llama-3.1-70b-instruct",
  },
  groq: {
    keyEnv: "GROQ_API_KEY",
    baseUrlEnv: "GROQ_API_BASE_URL",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    modelEnv: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
  },
};

function getProviderFromQuery(value: string | null): AiProvider | null {
  if (value === "z-ai" || value === "nvidia" || value === "groq") return value;
  return null;
}

function isAiProvider(value: unknown): value is AiProvider {
  return value === "z-ai" || value === "nvidia" || value === "groq";
}

function getProviderConfig(provider: AiProvider) {
  const cfg = PROVIDERS[provider];
  const apiKey = process.env[cfg.keyEnv];
  const baseUrl = (process.env[cfg.baseUrlEnv] || cfg.defaultBaseUrl).replace(/\/$/, "");
  const model = process.env[cfg.modelEnv] || cfg.defaultModel;
  return { cfg, apiKey, baseUrl, model };
}

function extractErrorMessage(raw: unknown, fallback: string): string {
  if (!raw || typeof raw !== "object") return fallback;
  if ("error" in raw && raw.error && typeof raw.error === "object" && "message" in raw.error) {
    const msg = (raw.error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

async function fetchProviderModels(provider: AiProvider) {
  const { apiKey, baseUrl, model } = getProviderConfig(provider);
  if (!apiKey) {
    return NextResponse.json({ error: `Missing API key for ${provider}.` }, { status: 500 });
  }

  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const raw = (await response.json().catch(() => ({}))) as {
    data?: Array<{ id?: string }>;
    models?: Array<{ id?: string; name?: string }>;
  };

  if (!response.ok) {
    const message = extractErrorMessage(raw, `Failed to fetch models (${response.status})`);
    return NextResponse.json({ error: message }, { status: response.status });
  }

  const idsFromData = Array.isArray(raw.data)
    ? raw.data.map((item) => item?.id).filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const idsFromModels = Array.isArray(raw.models)
    ? raw.models
        .map((item) => item?.id || item?.name)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  const models = Array.from(new Set([...idsFromData, ...idsFromModels]));
  return NextResponse.json({ provider, models, defaultModel: model });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provider = getProviderFromQuery(searchParams.get("provider"));

  if (provider) {
    try {
      return await fetchProviderModels(provider);
    } catch {
      return NextResponse.json({ error: "Failed to fetch provider models." }, { status: 500 });
    }
  }

  return NextResponse.json({
    providers: (Object.keys(PROVIDERS) as AiProvider[]).map((id) => ({
      id,
      configured: Boolean(getProviderConfig(id).apiKey),
      defaultModel: getProviderConfig(id).model,
    })),
    defaultProvider: "groq",
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AiRequestBody;
    const action = body.action;
    const text = (body.text || "").trim();
    const provider = isAiProvider(body.provider) ? body.provider : "groq";
    const instruction = (body.instruction || "").trim();
    const webSearchQuery = (body.webSearchQuery || "").trim();

    if (!action || !(action in ACTION_PROMPTS)) {
      return NextResponse.json({ error: "Invalid AI action" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "No text provided for AI processing" }, { status: 400 });
    }
    if (action === "custom" && !instruction) {
      return NextResponse.json({ error: "Custom instruction is required." }, { status: 400 });
    }

    const { apiKey, baseUrl, model: defaultModel } = getProviderConfig(provider);
    const model = (body.model || defaultModel).trim();
    const webContext = webSearchQuery ? await fetchWebContext(webSearchQuery) : "";

    if (!apiKey) {
      return NextResponse.json(
        { error: `Missing API key for ${provider} in server environment.` },
        { status: 500 },
      );
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are an expert BlockNote editor assistant. Be highly context-aware, preserve core facts unless instructed otherwise, keep formatting clean, and return only markdown without code fences.",
          },
          {
            role: "user",
            content: `${buildUserPrompt(action, text, instruction)}${
              webContext
                ? `\n\nUse this web context where relevant (prefer document facts when there is a conflict):\n${webContext}`
                : ""
            }`,
          },
        ],
      }),
    });

    const raw = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      const message = extractErrorMessage(raw, `AI request failed with status ${response.status}`);
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const output = raw.choices?.[0]?.message?.content?.trim();
    if (!output) {
      return NextResponse.json({ error: "AI returned empty output" }, { status: 502 });
    }

    return NextResponse.json({ text: output, provider, model, webSearchUsed: Boolean(webContext) });
  } catch {
    return NextResponse.json({ error: "Failed to process AI request" }, { status: 500 });
  }
}
