"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Link as LinkIcon, Share2, UserPlus } from "lucide-react";
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
import { addMemberDirectly } from "@/lib/actions/circles";
import type { KnownSquadUser } from "@/lib/circles";

export type ActiveInvite = { code: string };

type Props = {
  circleId: string;
  isAdmin: boolean;
  activeInvites: ActiveInvite[];
  knownUsers?: KnownSquadUser[];
  variant?: "compact" | "row";
};

type DisplayInvite = { code: string; url: string };

export function InviteButton({
  circleId,
  isAdmin,
  activeInvites,
  knownUsers = [],
  variant = "compact",
}: Props) {
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
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [addingId, setAddingId] = useState<string | null>(null);

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

  async function onAddDirectly(user: KnownSquadUser) {
    setAddingId(user.id);
    try {
      await addMemberDirectly({ circleId, userId: user.id });
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.add(user.id);
        return next;
      });
      toast.success(`Added ${user.displayName}`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't add that user.";
      toast.error(msg);
    } finally {
      setAddingId(null);
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
        {variant === "row" ? (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink/10 bg-paper-card/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
          >
            <Share2 className="size-4" aria-hidden /> Invite friends
          </button>
        ) : (
          <Button variant="outline" size="sm">
            <LinkIcon /> Invite
          </Button>
        )}
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

        {isAdmin && knownUsers.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add directly
            </h3>
            <p className="text-xs text-muted-foreground">
              People already on Squad you share another circle with.
            </p>
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {knownUsers.map((u) => {
                const isAdded = addedIds.has(u.id);
                const isBusy = addingId === u.id;
                return (
                  <li
                    key={u.id}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5"
                  >
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatarUrl}
                        alt=""
                        className="size-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
                        {u.displayName.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {u.displayName}
                    </span>
                    <Button
                      size="sm"
                      variant={isAdded ? "ghost" : "outline"}
                      onClick={() => onAddDirectly(u)}
                      disabled={isAdded || isBusy}
                      className="shrink-0"
                    >
                      {isAdded ? (
                        <>
                          <Check /> Added
                        </>
                      ) : isBusy ? (
                        "Adding…"
                      ) : (
                        <>
                          <UserPlus /> Add
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="my-1 border-t border-ink/10" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Or share a link
            </h3>
          </section>
        ) : null}

        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "No active invite links. Grab one below and drop it in WhatsApp."
              : "No invite links yet. Ask an admin to make one."}
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2">
            {list.map((invite) => (
              <li
                key={invite.code}
                className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2"
              >
                <code className="min-w-0 flex-1 truncate font-mono text-xs">
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
                ? "Getting link…"
                : list.length > 0
                  ? "Get a new link"
                  : "Get invite link"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
