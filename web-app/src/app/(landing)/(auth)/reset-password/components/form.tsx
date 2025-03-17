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
import { authClient } from "@/lib/auth.client";

import {
  resetPasswordFormData,
  resetPasswordFormSchema,
  type ResetPasswordFormSchemaType,
} from "./data";

interface ResetPasswordFormProps {
  token?: string;
}

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations("Auth.Pages.ResetPassword.Form");
  const router = useRouter();

  const form = useForm<ResetPasswordFormSchemaType>({
    resolver: zodResolver(resetPasswordFormSchema(t)),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (values: ResetPasswordFormSchemaType) => {
    if (!token) {
      toast.error("Invalid or missing reset token");
      return;
    }

    const { password } = values;
    await authClient.resetPassword({
      newPassword: password,
      token,
      fetchOptions: {
        onRequest: () => {
          setLoading(true);
        },
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message || "Failed to reset password");
        },
        onSuccess: () => {
          toast.success("Password reset successfully");
          router.push("/signin");
        },
      },
    });
  };

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
            {t("reset_password")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
