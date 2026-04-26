"use client";

import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function NewPlanButton() {
  return (
    <Button
      size="lg"
      className="fixed bottom-6 right-6 h-14 rounded-full px-6 shadow-lg sm:bottom-8 sm:right-8"
      onClick={() => toast.info("Coming in M4")}
    >
      <Plus className="size-5" />
      New plan
    </Button>
  );
}
