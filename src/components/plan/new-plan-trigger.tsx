"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { NewPlanForm } from "./new-plan-form";

const DESKTOP_QUERY = "(min-width: 640px)";

export function NewPlanTrigger({
  circleId,
  slug,
}: {
  circleId: string;
  slug: string;
}) {
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
      <Button
        size="lg"
        onClick={() => setOpen(true)}
        className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-6 z-40 h-14 rounded-full px-6 shadow-lg sm:bottom-8 sm:right-8"
      >
        <Plus className="size-5" />
        New plan
      </Button>

      {mounted &&
        (isDesktop ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New plan</DialogTitle>
              </DialogHeader>
              <NewPlanForm
                circleId={circleId}
                slug={slug}
                onDone={() => setOpen(false)}
              />
            </DialogContent>
          </Dialog>
        ) : (
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent
              side="bottom"
              className="h-[92vh] gap-0 overflow-y-auto rounded-t-xl p-0"
            >
              <SheetHeader className="border-b">
                <SheetTitle>New plan</SheetTitle>
              </SheetHeader>
              <NewPlanForm
                circleId={circleId}
                slug={slug}
                onDone={() => setOpen(false)}
              />
            </SheetContent>
          </Sheet>
        ))}
    </>
  );
}
