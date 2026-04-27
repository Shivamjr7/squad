"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function PlanStatusActions() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button
        variant="outline"
        onClick={() => toast.info("Coming in M7")}
        className="flex-1"
      >
        <CheckCircle2 /> Mark done
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.info("Coming in M7")}
        className="flex-1"
      >
        <XCircle /> Cancel plan
      </Button>
    </div>
  );
}
