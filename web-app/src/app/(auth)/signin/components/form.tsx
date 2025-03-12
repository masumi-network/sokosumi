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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth.client";

import { signInFormData, signInFormSchema, SignInFormSchemaType } from "./data";

export default function SignInForm() {
  const t = useTranslations("Auth.Pages.SignIn.Form");
  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(signInFormSchema(t)),
    defaultValues: {
      email: "",
      password: "",
    },
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (values: SignInFormSchemaType) => {
    const { email, password } = values;
    await signIn.email({
      email,
      password,
      fetchOptions: {
        onRequest: () => {
          setLoading(true);
        },
        onResponse: () => {
          setLoading(false);
        },
        onError: (ctx) => {
          toast.error(ctx.error.message || "Failed");
        },
        onSuccess: () => {
          toast.success("Success");
          router.push("/dashboard");
        },
      },
    });
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-6"
      >
        {signInFormData.map(
          ({ name, labelKey, placeholderKey, type, descriptionKey }) => (
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
                  {descriptionKey && (
                    <FormDescription>{t(descriptionKey)}</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          ),
        )}
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />} Continue
        </Button>
      </form>
    </Form>
  );
}
