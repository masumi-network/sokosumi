"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
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

import { forgotPassword } from "../actions";
import {
  forgotPasswordFormData,
  forgotPasswordFormSchema,
  type ForgotPasswordFormSchemaType,
} from "./data";

export default function ForgotPasswordForm() {
  const t = useTranslations("Auth.Pages.ForgotPassword.Form");
  const router = useRouter();

  const form = useForm<ForgotPasswordFormSchemaType>({
    resolver: zodResolver(forgotPasswordFormSchema(t)),
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(values: ForgotPasswordFormSchemaType) {
    const formData = new FormData();
    formData.append("email", values.email);

    const result = await forgotPassword(formData);

    if (result.error) {
      toast.error(t("error"));
      return;
    }

    toast.success(t("success"));
    router.push("/signin");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset
          disabled={form.formState.isSubmitting}
          className="flex flex-col gap-6"
        >
          {forgotPasswordFormData.map(
            ({ name, labelKey, placeholderKey, type }) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{labelKey && t(labelKey)}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={placeholderKey && t(placeholderKey)}
                        type={type || "text"}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ),
          )}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("reset_password")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
