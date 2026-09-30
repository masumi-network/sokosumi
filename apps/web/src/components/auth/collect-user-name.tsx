"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FirstAndLastNameFields } from "@/components/auth/first-and-last-name-fields";
import { Form } from "@/components/ui/form";
import {
  persistFirstAndLastName,
  userHasName,
} from "@/lib/auth/persist-user-name";
import {
  type FirstAndLastNameFormType,
  firstAndLastNameFormSchema,
} from "@/lib/schemas/account";

export function useCollectUserName(initialName: string) {
  const tName = useTranslations("Library.Auth.NameField");
  const tSchema = useTranslations("Library.Auth.Schema");
  const needsName = !userHasName(initialName);
  const form = useForm<FirstAndLastNameFormType>({
    resolver: zodResolver(firstAndLastNameFormSchema(tSchema)),
    defaultValues: { firstName: "", lastName: "" },
  });

  async function persistIfNeeded(): Promise<boolean> {
    if (!needsName) {
      return true;
    }
    let saved = false;
    await form.handleSubmit(async (values) => {
      const result = await persistFirstAndLastName(values, initialName);
      if (result.isErr()) {
        toast.error(result.error ?? tName("persistError"));
        return;
      }
      saved = true;
    })();
    return saved;
  }

  function NameFields({ disabled }: { disabled?: boolean }) {
    if (!needsName) {
      return null;
    }
    return (
      <Form {...form}>
        <FirstAndLastNameFields
          control={form.control}
          testIdPrefix="collect-user"
          disabled={disabled}
        />
      </Form>
    );
  }

  return { needsName, persistIfNeeded, NameFields };
}
