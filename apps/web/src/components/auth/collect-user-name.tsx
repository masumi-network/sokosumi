"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { persistUserName, userHasName } from "@/lib/auth/persist-user-name";
import { type NameFormType, nameFormSchema } from "@/lib/schemas";

export function useCollectUserName(initialName: string) {
  const tName = useTranslations("Library.Auth.NameField");
  const tSchema = useTranslations("Library.Auth.Schema");
  const needsName = !userHasName(initialName);
  const form = useForm<NameFormType>({
    resolver: zodResolver(nameFormSchema(tSchema)),
    defaultValues: { name: initialName },
  });

  async function persistIfNeeded(): Promise<boolean> {
    if (!needsName) {
      return true;
    }
    const valid = await form.trigger();
    if (!valid) {
      return false;
    }
    const result = await persistUserName(form.getValues("name"));
    if (!result.ok) {
      toast.error(result.message ?? tName("persistError"));
      return false;
    }
    return true;
  }

  function NameFields({ disabled }: { disabled?: boolean }) {
    if (!needsName) {
      return null;
    }
    return (
      <Form {...form}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tName("label")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="name"
                  disabled={disabled}
                  placeholder={tName("placeholder")}
                  data-testid="collect-user-name"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    );
  }

  return { needsName, persistIfNeeded, NameFields };
}
