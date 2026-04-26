"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { createCircle } from "@/lib/actions/circles";
import {
  createCircleSchema,
  type CreateCircleInput,
} from "@/lib/validation/circle";
import { slugify } from "@/lib/slug";

export function CreateCircleForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Auto-derive slug from name UNTIL the user types in the slug field.
  // If they clear it back to empty, re-enable auto-derive.
  const [slugManual, setSlugManual] = useState(false);

  const form = useForm<CreateCircleInput>({
    resolver: zodResolver(createCircleSchema),
    defaultValues: { name: "", slug: "" },
    mode: "onTouched",
  });

  const slugValue = form.watch("slug");

  function onNameChange(value: string) {
    form.setValue("name", value, { shouldValidate: form.formState.isSubmitted });
    if (!slugManual) {
      form.setValue("slug", slugify(value), {
        shouldValidate: form.formState.isSubmitted,
      });
    }
  }

  function onSlugChange(value: string) {
    form.setValue("slug", value, { shouldValidate: form.formState.isSubmitted });
    if (value === "") {
      setSlugManual(false);
      // Re-derive from current name once auto mode is back on.
      const name = form.getValues("name");
      if (name) form.setValue("slug", slugify(name));
    } else {
      setSlugManual(true);
    }
  }

  function onSubmit(values: CreateCircleInput) {
    startTransition(async () => {
      try {
        const { slug } = await createCircle(values);
        toast.success("Circle created");
        router.push(`/c/${slug}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        toast.error(msg);
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-5"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Circle name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Hyderabad Crew"
                  autoFocus
                  autoComplete="off"
                  maxLength={40}
                  onChange={(e) => onNameChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Circle URL</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="hyderabad-crew"
                  autoComplete="off"
                  maxLength={40}
                  onChange={(e) => onSlugChange(e.target.value)}
                />
              </FormControl>
              <FormDescription>
                {slugValue
                  ? `Your circle URL: /c/${slugValue}`
                  : "Letters, numbers, and hyphens only."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          size="lg"
          className="sticky bottom-4 mt-2 h-12 text-base shadow-md sm:static sm:shadow-none"
          disabled={pending}
        >
          {pending ? "Creating…" : "Create circle"}
        </Button>
      </form>
    </Form>
  );
}
