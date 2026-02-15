"use client";

import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useEffect } from "react";

interface EditorProps {
  initialContent?: string;
  onChange?: (content: string) => void;
}

export default function Editor({ initialContent, onChange }: EditorProps) {
  const editor = useCreateBlockNote();

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

  return (
    <div className="doc-editor h-full w-full bg-white overflow-y-auto">
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
