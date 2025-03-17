"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
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

import { resetPassword } from "../actions";
import {
  resetPasswordFormData,
  resetPasswordFormSchema,
  type ResetPasswordFormSchemaType,
} from "./data";

interface ResetPasswordFormProps {
  token: string;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ResetPassword.Form");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const form = useForm<ResetPasswordFormSchemaType>({
    resolver: zodResolver(resetPasswordFormSchema(t)),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: ResetPasswordFormSchemaType) {
    setLoading(true);

    const formData = new FormData();
    formData.append("password", values.password);
    formData.append("token", token);

    const result = await resetPassword(formData);

    setLoading(false);

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
        <fieldset disabled={loading} className="flex flex-col gap-6">
          {resetPasswordFormData.map(
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
          <Button type="submit" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("submit")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
