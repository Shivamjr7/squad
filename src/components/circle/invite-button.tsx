"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Link as LinkIcon, Share2 } from "lucide-react";
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
import { generateInvite } from "@/lib/actions/invites";

export type ActiveInvite = { code: string };

type Props = {
  circleId: string;
  isAdmin: boolean;
  activeInvites: ActiveInvite[];
};

type DisplayInvite = { code: string; url: string };

export function InviteButton({ circleId, isAdmin, activeInvites }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Server can't safely pre-build URLs without a per-request fetch; building
  // them on the client from window.location.origin is correct for both
  // dev and prod and keeps this component self-contained.
  const [origin, setOrigin] = useState<string | null>(null);
  const [generated, setGenerated] = useState<DisplayInvite[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

  const existing: DisplayInvite[] = origin
    ? activeInvites.map((inv) => ({
        code: inv.code,
        url: `${origin}/invite/${inv.code}`,
      }))
    : [];

  // De-dupe in case a freshly generated code shows up after the page revalidates.
  const seen = new Set(existing.map((i) => i.code));
  const list: DisplayInvite[] = [
    ...generated.filter((i) => !seen.has(i.code)),
    ...existing,
  ];

  function onGenerate() {
    startTransition(async () => {
      try {
        const result = await generateInvite({ circleId });
        setGenerated((prev) => [{ code: result.code, url: result.url }, ...prev]);
        setCopiedCode(null);
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not create invite.";
        toast.error(msg);
      }
    });
  }

  async function onCopy(invite: DisplayInvite) {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopiedCode(invite.code);
      toast.success("Invite link copied");
      setTimeout(() => setCopiedCode((c) => (c === invite.code ? null : c)), 2000);
    } catch {
      toast.error("Couldn't copy — long-press the link to copy manually.");
    }
  }

  async function onShare(invite: DisplayInvite) {
    try {
      await navigator.share({
        title: "Join my circle on Squad",
        text: "Join my circle on Squad",
        url: invite.url,
      });
    } catch (err) {
      // User cancelling the native share sheet throws AbortError — ignore.
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error("Couldn't open share sheet.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setGenerated([]);
          setCopiedCode(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LinkIcon /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to this circle</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Share an existing link or generate a new one. Anyone with the link can join."
              : "Share an existing link with friends. Anyone with the link can join."}
          </DialogDescription>
        </DialogHeader>

        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "No active invite links yet. Generate one to share via WhatsApp."
              : "No active invite links. Ask an admin to generate one."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((invite) => (
              <li
                key={invite.code}
                className="flex items-center gap-2 rounded-md border px-3 py-2"
              >
                <code className="flex-1 truncate font-mono text-xs">
                  {invite.url}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onCopy(invite)}
                  aria-label="Copy link"
                >
                  {copiedCode === invite.code ? <Check /> : <Copy />}
                </Button>
                {canShare ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onShare(invite)}
                    aria-label="Share link"
                  >
                    <Share2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {isAdmin ? (
          <DialogFooter>
            <Button onClick={onGenerate} disabled={pending}>
              {pending
                ? "Generating…"
                : list.length > 0
                  ? "Generate new link"
                  : "Generate invite link"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
