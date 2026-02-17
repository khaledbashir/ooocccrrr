"use client";

import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  Send,
  MessageSquarePlus,
  Copy,
  Check,
  Bot,
  UserCircle2,
} from "lucide-react";
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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
};

type EditorMode = "edit" | "chat";

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

function initialChatMessages(): ChatMessage[] {
  return [
    {
      id: "chat-welcome",
      role: "assistant",
      text: "I am ready. Ask me to rewrite, summarize, extract requirements, or create a checklist from this document.",
      createdAt: Date.now(),
    },
  ];
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Editor({ initialContent, onChange }: EditorProps) {
  const editor = useCreateBlockNote();
  const messagesRef = useRef<HTMLDivElement>(null);
  const [isRunningAi, setIsRunningAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [provider, setProvider] = useState<AiProvider>("groq");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [webSearchQuery, setWebSearchQuery] = useState("");
  const [isAiToolbarOpen, setIsAiToolbarOpen] = useState(false);
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [chatMessages, isRunningAi]);

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

      await applyMarkdownToEditor(aiText);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI request failed";
      setAiError(message);
    } finally {
      setIsRunningAi(false);
    }
  }

  async function applyMarkdownToEditor(markdown: string) {
    const blocks = await editor.tryParseMarkdownToBlocks(markdown);
    editor.replaceBlocks(editor.document, blocks);
  }

  async function sendChatMessage() {
    if (isRunningAi) return;

    const prompt = chatInput.trim();
    if (!prompt) return;

    setAiError(null);
    setIsRunningAi(true);
    setChatInput("");

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: prompt,
      createdAt: Date.now(),
    };
    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);

    const blocks = editor.document as unknown as EditorBlock[];
    const currentPlainText = blocksToPlainText(blocks);

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "custom",
          text: currentPlainText || "The document is currently empty.",
          provider,
          model: model || undefined,
          instruction: [
            "You are an AI document copilot in chat mode.",
            mode === "edit"
              ? "You are in EDIT MODE: prioritize returning full revised markdown ready to apply to the document."
              : "You are in CHAT MODE: focus on analysis, options, and concise guidance before rewriting.",
            "Respond as a concise assistant in markdown with clear structure.",
            "Preserve key numbers and entities from the document unless the user asks otherwise.",
            "Recent chat context:",
            nextMessages
              .slice(-8)
              .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
              .join("\n"),
            `User message: ${prompt}`,
          ].join("\n"),
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

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: aiText,
        createdAt: Date.now(),
      };
      setChatMessages((current) => [...current, assistantMessage]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI request failed";
      setAiError(message);
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: `Error: ${message}`,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setIsRunningAi(false);
    }
  }

  function resetChat() {
    setChatMessages(initialChatMessages());
    setChatInput("");
    setAiError(null);
  }

  async function copyMessage(messageId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      window.setTimeout(() => setCopiedMessageId((current) => (current === messageId ? null : current)), 1400);
    } catch {
      setAiError("Could not copy message to clipboard.");
    }
  }

  const quickPrompts = [
    "Extract mandatory submission requirements.",
    "Turn this into a bid checklist.",
    "List high-risk compliance items.",
    "Rewrite as executive summary.",
  ];

  return (
    <div className="doc-editor h-full w-full bg-white flex overflow-hidden">
      <div className="flex-1 min-w-0 h-full overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
          <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setIsAiToolbarOpen((open) => !open)}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {isAiToolbarOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              AI Toolbar
            </button>
            <button
              onClick={() => setIsChatSidebarOpen((open) => !open)}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {isChatSidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              AI Chat
            </button>
            {aiError ? (
              <span className="text-xs text-red-600 truncate" title={aiError}>
                {aiError}
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                {isChatSidebarOpen ? `${mode === "chat" ? "Chat" : "Edit"} mode active` : "AI chat hidden"}
              </span>
            )}
          </div>

          {isAiToolbarOpen ? (
            <div className="px-3 pb-3 flex items-center gap-2 flex-wrap border-t border-slate-100 pt-2">
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
            </div>
          ) : null}
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

      <aside
        className={`h-full border-l border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100 transition-all duration-300 ${
          isChatSidebarOpen ? "w-full md:w-[430px]" : "w-0 overflow-hidden border-l-0"
        }`}
      >
        <div className="h-full flex flex-col">
          <div className="px-3 py-3 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">AI Chat</p>
                <p className="text-xs text-slate-500">
                  {mode === "edit"
                    ? "Edit mode: replies are optimized for direct document updates"
                    : "Chat mode: discuss and refine before applying changes"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetChat}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <MessageSquarePlus size={12} />
                  New Chat
                </button>
                <button
                  type="button"
                  onClick={() => setIsChatSidebarOpen(false)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <PanelRightClose size={12} />
                  Hide
                </button>
              </div>
            </div>
            <div className="mt-3 inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setMode("edit")}
                className={`rounded px-2 py-1 text-xs font-semibold ${mode === "edit" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                Edit Mode
              </button>
              <button
                type="button"
                onClick={() => setMode("chat")}
                className={`rounded px-2 py-1 text-xs font-semibold ${mode === "chat" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                Chat Mode
              </button>
            </div>
          </div>
          <div ref={messagesRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {chatMessages.map((message) => (
              <div key={message.id} className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role === "assistant" ? (
                  <div className="mt-1 h-7 w-7 rounded-full bg-slate-800 text-white flex items-center justify-center shrink-0">
                    <Bot size={14} />
                  </div>
                ) : null}
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${
                    message.role === "user"
                      ? "bg-slate-900 text-white rounded-tr-sm"
                      : "bg-white text-slate-700 border border-slate-200 rounded-tl-sm"
                  }`}
                >
                  <p className="text-sm leading-6 whitespace-pre-wrap break-words">{message.text}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={`text-[11px] ${message.role === "user" ? "text-slate-300" : "text-slate-400"}`}>
                      {formatTime(message.createdAt)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={`text-[11px] rounded px-2 py-1 ${
                          message.role === "user"
                            ? "bg-white/15 text-white hover:bg-white/25"
                            : "border border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                        onClick={() => void copyMessage(message.id, message.text)}
                      >
                        {copiedMessageId === message.id ? (
                          <span className="inline-flex items-center gap-1">
                            <Check size={11} />
                            Copied
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Copy size={11} />
                            Copy
                          </span>
                        )}
                      </button>
                      {message.role === "assistant" && !message.text.startsWith("Error:") ? (
                        <button
                          type="button"
                          className="text-[11px] rounded border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-100"
                          onClick={() => void applyMarkdownToEditor(message.text)}
                        >
                          Apply
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                {message.role === "user" ? (
                  <div className="mt-1 h-7 w-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                    <UserCircle2 size={14} />
                  </div>
                ) : null}
              </div>
            ))}
            {isRunningAi ? (
              <div className="flex gap-2 items-center">
                <div className="h-7 w-7 rounded-full bg-slate-800 text-white flex items-center justify-center shrink-0">
                  <Bot size={14} />
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-200 px-3 py-2 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Thinking...
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          <div className="border-t border-slate-200 bg-white p-3 space-y-2">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setChatInput(prompt)}
                  className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask AI to edit this document..."
              className="w-full min-h-24 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 bg-slate-50/70 focus:outline-none focus:ring-2 focus:ring-slate-300"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChatMessage();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-slate-500">Enter to send, Shift+Enter for newline</p>
              <button
                type="button"
                onClick={() => void sendChatMessage()}
                disabled={isRunningAi || isLoadingModels || !chatInput.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-4 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {isRunningAi ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
