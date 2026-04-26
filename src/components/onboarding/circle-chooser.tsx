"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateCircleForm } from "./create-circle-form";
import { JoinViaCodeForm } from "./join-via-code-form";

type Mode = "chooser" | "create" | "join";

export function CircleChooser() {
  const [mode, setMode] = useState<Mode>("chooser");

  if (mode === "create") {
    return (
      <section className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setMode("chooser")}
          className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        <CreateCircleForm />
      </section>
    );
  }

  if (mode === "join") {
    return (
      <section className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setMode("chooser")}
          className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        <JoinViaCodeForm />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <Button
        size="lg"
        className="h-14 text-base"
        onClick={() => setMode("create")}
      >
        Create a circle
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="h-14 text-base"
        onClick={() => setMode("join")}
      >
        Have an invite link?
      </Button>
    </section>
  );
}
