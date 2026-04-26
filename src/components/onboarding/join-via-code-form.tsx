"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JoinViaCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    // Accept either a raw code or a full /invite/<code> URL paste.
    const match = trimmed.match(/\/invite\/([^/?#\s]+)/);
    const finalCode = match ? match[1] : trimmed;
    router.push(`/invite/${encodeURIComponent(finalCode)}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-code">Invite code or link</Label>
        <Input
          id="invite-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Paste your invite link or code"
          autoFocus
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Paste the full link your friend sent, or just the code at the end of it.
        </p>
      </div>
      <Button
        type="submit"
        size="lg"
        className="sticky bottom-4 h-12 text-base shadow-md sm:static sm:shadow-none"
        disabled={!code.trim()}
      >
        Join
      </Button>
    </form>
  );
}
