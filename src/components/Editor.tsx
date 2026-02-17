"use client";

import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { EditorProps } from "@/types";

type AiAction = "summarize" | "improve" | "expand" | "custom";
type AiProvider = "z-ai" | "nvidia" | "groq";

type InlineNode = {
  text?: string;
  content?: InlineNode[];
};

type EditorBlock = {
  content?: InlineNode[] | string;
  children?: EditorBlock[];
};

function inlineText(content: InlineNode[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((node) => {
      if (typeof node.text === "string") return node.text;
      if (Array.isArray(node.content)) return inlineText(node.content);
      return "";
    })
    .join("");
}

function blocksToPlainText(blocks: EditorBlock[]): string {
  return blocks
    .map((block) => {
      const line = inlineText(block.content);
      const childText = Array.isArray(block.children) ? blocksToPlainText(block.children) : "";
      return [line, childText].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export default function Editor({ initialContent, onChange }: EditorProps) {
  const editor = useCreateBlockNote();
  const [isRunningAi, setIsRunningAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [provider, setProvider] = useState<AiProvider>("groq");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [webSearchQuery, setWebSearchQuery] = useState("");

  useEffect(() => {
    async function loadContent() {
      if (initialContent && editor) {
        // Try to parse as markdown or just use as text
        const blocks = await editor.tryParseMarkdownToBlocks(initialContent);
        editor.replaceBlocks(editor.document, blocks);
      }
    }
    loadContent();
  }, [initialContent, editor]);

  useEffect(() => {
    async function loadModels() {
      setIsLoadingModels(true);
      setAiError(null);
      try {
        const response = await fetch(`/api/ai?provider=${provider}`);
        const payload = (await response.json()) as {
          models?: string[];
          defaultModel?: string;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load models");
        }

        const providerModels = payload.models || [];
        setModels(providerModels);
        if (providerModels.length > 0) {
          setModel((current) => {
            if (current && providerModels.includes(current)) return current;
            if (payload.defaultModel && providerModels.includes(payload.defaultModel)) return payload.defaultModel;
            return providerModels[0];
          });
        } else {
          setModel(payload.defaultModel || "");
        }
      } catch (error: unknown) {
        setModels([]);
        setModel("");
        setAiError(error instanceof Error ? error.message : "Failed to load models");
      } finally {
        setIsLoadingModels(false);
      }
    }

    loadModels();
  }, [provider]);

  async function runAi(action: AiAction) {
    if (isRunningAi) return;
    const blocks = editor.document as unknown as EditorBlock[];
    const currentPlainText = blocksToPlainText(blocks);

    if (!currentPlainText.trim()) {
      setAiError("Editor is empty. Add some text first.");
      return;
    }
    if (action === "custom" && !customInstruction.trim()) {
      setAiError("Enter an instruction, for example: make this a markdown table.");
      return;
    }

    setAiError(null);
    setIsRunningAi(true);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          text: currentPlainText,
          provider,
          model: model || undefined,
          instruction: action === "custom" ? customInstruction.trim() : undefined,
          webSearchQuery: webSearchQuery.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "AI request failed");
      }

      const aiText = (payload.text || "").trim();
      if (!aiText) {
        throw new Error("AI returned empty content");
      }

      const blocks = await editor.tryParseMarkdownToBlocks(aiText);
      editor.replaceBlocks(editor.document, blocks);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI request failed";
      setAiError(message);
    } finally {
      setIsRunningAi(false);
    }
  }

  return (
    <div className="doc-editor h-full w-full bg-white overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2 flex-wrap">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as AiProvider)}
          className="h-8 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700 bg-white"
          title="AI provider"
        >
          <option value="groq">Groq</option>
          <option value="nvidia">NVIDIA</option>
          <option value="z-ai">Z AI</option>
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-8 min-w-56 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700 bg-white"
          title="AI model"
          disabled={isLoadingModels || models.length === 0}
        >
          {isLoadingModels ? (
            <option value="">Loading models...</option>
          ) : models.length === 0 ? (
            <option value="">{model || "No models found"}</option>
          ) : (
            models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))
          )}
        </select>
        <button
          onClick={() => runAi("summarize")}
          disabled={isRunningAi || isLoadingModels}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {isRunningAi ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Summarize
        </button>
        <button
          onClick={() => runAi("improve")}
          disabled={isRunningAi || isLoadingModels}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Improve
        </button>
        <button
          onClick={() => runAi("expand")}
          disabled={isRunningAi || isLoadingModels}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Expand
        </button>
        <input
          value={customInstruction}
          onChange={(e) => setCustomInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runAi("custom");
            }
          }}
          placeholder='Try: "format this better", "make it a table", "turn this into bullets"'
          className="h-8 min-w-80 flex-1 rounded-md border border-slate-200 px-2 text-xs text-slate-700"
        />
        <input
          value={webSearchQuery}
          onChange={(e) => setWebSearchQuery(e.target.value)}
          placeholder='Optional web search query (example: "latest SEC AI disclosure rules")'
          className="h-8 min-w-80 flex-1 rounded-md border border-slate-200 px-2 text-xs text-slate-700"
        />
        <button
          onClick={() => runAi("custom")}
          disabled={isRunningAi || isLoadingModels}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60"
        >
          Do It
        </button>
        <button
          onClick={() => setCustomInstruction("Format this professionally with headings and clean spacing.")}
          type="button"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Format Better
        </button>
        <button
          onClick={() => setCustomInstruction("Convert key information into a markdown table.")}
          type="button"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Make Table
        </button>
        <button
          onClick={() => setCustomInstruction("Rewrite this as clear bullet points with short lines.")}
          type="button"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Bullet Points
        </button>
        {aiError ? (
          <span className="text-xs text-red-600 truncate" title={aiError}>
            {aiError}
          </span>
        ) : (
          <span className="text-xs text-slate-500">AI editor actions</span>
        )}
      </div>
      <BlockNoteView 
        editor={editor} 
        theme="light"
        onChange={() => {
          if (onChange) {
            onChange(JSON.stringify(editor.document));
          }
        }}
      />
    </div>
  );
}
