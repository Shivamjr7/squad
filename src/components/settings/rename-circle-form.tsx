"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { renameCircle } from "@/lib/actions/circles";
import {
  renameCircleSchema,
  type RenameCircleInput,
} from "@/lib/validation/circle";

export function RenameCircleForm({
  circleId,
  initialName,
}: {
  circleId: string;
  initialName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<RenameCircleInput>({
    resolver: zodResolver(renameCircleSchema),
    defaultValues: { name: initialName },
    mode: "onTouched",
  });

  function onSubmit(values: RenameCircleInput) {
    if (values.name === initialName) {
      toast.info("Name unchanged.");
      return;
    }
    startTransition(async () => {
      try {
        await renameCircle({ circleId, name: values.name });
        toast.success("Circle renamed");
        form.reset({ name: values.name });
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not rename circle.";
        toast.error(msg);
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormControl>
                <Input
                  {...field}
                  placeholder="Circle name"
                  autoComplete="off"
                  maxLength={40}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Done"}
        </Button>
      </form>
    </Form>
  );
}
