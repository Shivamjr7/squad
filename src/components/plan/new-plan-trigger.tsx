"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { NewPlanForm, type FormMember } from "./new-plan-form";

const DESKTOP_QUERY = "(min-width: 640px)";

type Props = {
  circleId: string;
  slug: string;
  members: FormMember[];
  currentUserId: string;
  mode?: "fab" | "header" | "cta";
};

export function NewPlanTrigger({
  circleId,
  slug,
  members,
  currentUserId,
  mode = "fab",
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
      {mode === "fab" ? (
        <Button
          size="lg"
          onClick={() => setOpen(true)}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-6 z-40 h-14 rounded-full px-6 shadow-lg sm:hidden"
        >
          <Plus className="size-5" />
          New plan
        </Button>
      ) : mode === "cta" ? (
        <Button
          size="lg"
          onClick={() => setOpen(true)}
          className="h-12 rounded-full bg-ink px-6 text-paper-card hover:bg-ink/90"
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
          className="size-9 rounded-full bg-ink text-paper-card hover:bg-ink/90"
        >
          <Plus className="size-5" />
        </Button>
      )}

      {mounted &&
        (isDesktop ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              showCloseButton={false}
              className="h-[min(720px,90vh)] max-w-lg gap-0 overflow-hidden p-0"
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
