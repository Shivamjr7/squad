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

export function EditDisplayName({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<SetDisplayNameInput>({
    resolver: zodResolver(setDisplayNameSchema),
    defaultValues: { displayName: initialName },
    mode: "onTouched",
  });

  const dirty = form.watch("displayName").trim() !== initialName.trim();

  function onSubmit(values: SetDisplayNameInput) {
    startTransition(async () => {
      try {
        await setDisplayName(values);
        toast.success("Name saved");
        form.reset({ displayName: values.displayName });
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't save.";
        toast.error(msg);
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-3"
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
                  autoComplete="off"
                  maxLength={40}
                  placeholder="Shivam"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
