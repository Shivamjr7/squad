"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateInvite } from "@/lib/actions/invites";

export function GenerateInviteForm({ circleId }: { circleId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function onGenerate() {
    startTransition(async () => {
      try {
        const result = await generateInvite({ circleId });
        setUrl(result.url);
        setCopied(false);
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not create invite.";
        toast.error(msg);
      }
    });
  }

  async function onCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — long-press the link to copy manually.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={onGenerate} disabled={pending} variant="outline">
        {pending ? "Getting link…" : "Get a new invite link"}
      </Button>
      {url ? (
        <div className="flex items-center gap-2">
          <Input value={url} readOnly className="font-mono text-xs" />
          <Button size="icon" variant="outline" onClick={onCopy} aria-label="Copy link">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
