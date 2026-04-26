"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { generateInvite } from "@/lib/actions/invites";

export function InviteButton({ circleId }: { circleId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function onGenerate() {
    startTransition(async () => {
      try {
        const result = await generateInvite({ circleId });
        setUrl(result.url);
        setCopied(false);
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUrl(null);
          setCopied(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <LinkIcon /> Invite friends
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to this circle</DialogTitle>
          <DialogDescription>
            Generate a link your friends can use to join. Anyone with the link
            can join until you delete the invite.
          </DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="flex items-center gap-2">
            <Input value={url} readOnly className="font-mono text-xs" />
            <Button size="icon" variant="outline" onClick={onCopy} aria-label="Copy link">
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click below to create a one-time link you can paste in WhatsApp.
          </p>
        )}

        <DialogFooter>
          <Button onClick={onGenerate} disabled={pending}>
            {pending ? "Generating…" : url ? "Generate another" : "Generate invite link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
