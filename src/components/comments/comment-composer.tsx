"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { COMMENT_BODY_MAX } from "@/lib/validation/comment";

type Props = {
  onSend: (body: string) => void;
};

export function CommentComposer({ onSend }: Props) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= COMMENT_BODY_MAX;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
    // Reset auto-grown height after send.
    if (taRef.current) {
      taRef.current.style.height = "";
      taRef.current.focus();
    }
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline. On phones, the on-screen
    // return key inserts a newline (no keydown), which is what we want.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={onFormSubmit}
      className={cn(
        "sticky bottom-0 z-10 -mx-4 mt-auto flex items-end gap-2 border-t bg-background px-4 py-3 sm:-mx-6 sm:px-6",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          // Auto-grow up to a small cap.
          const el = e.currentTarget;
          el.style.height = "";
          el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        }}
        onKeyDown={onKeyDown}
        rows={1}
        maxLength={COMMENT_BODY_MAX * 2}
        placeholder="Say something…"
        className="min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:text-sm"
      />
      <Button
        type="submit"
        size="icon"
        disabled={!canSend}
        aria-label="Send comment"
        className="size-10 shrink-0"
      >
        <Send className="size-4" />
      </Button>
    </form>
  );
}
