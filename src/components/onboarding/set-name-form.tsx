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
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { setDisplayName } from "@/lib/actions/users";
import {
  setDisplayNameSchema,
  type SetDisplayNameInput,
} from "@/lib/validation/user";

export function SetNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<SetDisplayNameInput>({
    resolver: zodResolver(setDisplayNameSchema),
    defaultValues: { displayName: initialName },
    mode: "onTouched",
  });

  function onSubmit(values: SetDisplayNameInput) {
    startTransition(async () => {
      try {
        await setDisplayName(values);
        toast.success("Name set");
        router.replace("/");
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
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoFocus
                  autoComplete="off"
                  maxLength={40}
                  placeholder="Shivam"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          size="lg"
          className="h-12 text-base"
          disabled={pending}
        >
          {pending ? "Saving…" : "Set name"}
        </Button>
      </form>
    </Form>
  );
}
