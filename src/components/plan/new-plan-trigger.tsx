"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { FormMember } from "./new-plan-form";

const DESKTOP_QUERY = "(min-width: 640px)";

const NewPlanForm = dynamic(
  () => import("./new-plan-form").then((mod) => mod.NewPlanForm),
  { loading: () => <NewPlanFormLoading /> },
);

type Props = {
  circleId: string;
  slug: string;
  members: FormMember[];
  currentUserId: string;
  mode?: "header" | "cta";
};

export function NewPlanTrigger({
  circleId,
  slug,
  members,
  currentUserId,
  mode = "header",
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      {mode === "cta" ? (
        <Button
          size="lg"
          onClick={() => setOpen(true)}
          className="h-12 rounded-full bg-ink px-6 text-paper shadow-float hover:bg-ink/90"
          data-tour="new-plan"
        >
          <Plus className="size-5" />
          Start a plan
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="New plan"
          className="size-9 rounded-full bg-ink text-paper hover:bg-ink/90"
          data-tour="new-plan"
        >
          <Plus className="size-5" />
        </Button>
      )}

      {mounted &&
        (isDesktop ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              showCloseButton={false}
              className="h-[min(720px,90vh)] max-w-lg grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0"
            >
              <DialogTitle className="sr-only">New plan</DialogTitle>
              <NewPlanForm
                circleId={circleId}
                slug={slug}
                members={members}
                currentUserId={currentUserId}
                onDone={() => setOpen(false)}
              />
            </DialogContent>
          </Dialog>
        ) : (
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent
              side="bottom"
              showCloseButton={false}
              className="h-[100dvh] gap-0 p-0"
            >
              <SheetTitle className="sr-only">New plan</SheetTitle>
              <NewPlanForm
                circleId={circleId}
                slug={slug}
                members={members}
                currentUserId={currentUserId}
                onDone={() => setOpen(false)}
              />
            </SheetContent>
          </Sheet>
        ))}
    </>
  );
}

function NewPlanFormLoading() {
  return (
    <div className="flex h-full flex-col bg-paper px-5 py-6">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
        New plan
      </span>
      <div className="mt-8 flex flex-col gap-4">
        <div className="h-10 w-3/4 rounded-xl bg-ink/10" />
        <div className="h-11 rounded-xl bg-ink/10" />
        <div className="h-11 rounded-xl bg-ink/10" />
        <div className="h-24 rounded-2xl bg-ink/10" />
      </div>
    </div>
  );
}
