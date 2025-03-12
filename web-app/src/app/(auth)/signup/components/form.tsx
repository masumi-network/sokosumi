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
import { signUp } from "@/lib/auth.client";

import { signUpFormData, signUpFormSchema, SignUpFormSchemaType } from "./data";

export default function SignUpForm() {
  const t = useTranslations("Auth.Pages.SignUp.Form");
  const router = useRouter();

  const form = useForm<SignUpFormSchemaType>({
    resolver: zodResolver(signUpFormSchema(t)),
    defaultValues: {
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (values: SignUpFormSchemaType) => {
    const { username, email, password } = values;
    await signUp.email({
      name: username,
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
          router.push("/signin");
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
        {signUpFormData.map(
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
