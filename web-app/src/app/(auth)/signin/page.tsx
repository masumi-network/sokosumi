"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { SiGithub, SiGoogle } from "@icons-pack/react-simple-icons";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { FormData } from "@/lib/form";

import { signInFormSchema, SignInFormSchemaType } from "./data";

const formData: FormData<SignInFormSchemaType> = [
  { name: "email", label: "Email", placeholder: "me@example.com" },
  {
    name: "password",
    label: "Password",
    placeholder: "Password",
    type: "password",
  },
];

export default function SignIn() {
  const router = useRouter();

  const form = useForm<SignInFormSchemaType>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (values: SignInFormSchemaType) => {
    const { email, password } = values;
    const result = await signIn.email({
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
    console.log(result);
  };

  return (
    <>
      <div className="flex items-center justify-around gap-4">
        <Button
          className="flex flex-1 items-center justify-center gap-2 font-bold"
          variant="outline"
        >
          <SiGithub /> Github
        </Button>
        <Button
          className="flex flex-1 items-center justify-center gap-2 font-bold"
          variant="outline"
        >
          <SiGoogle /> Google
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <hr className="h-0 flex-1 border-0 border-t border-gray-200" />
        <span className="text-xs uppercase text-gray-400">
          Or Continue With
        </span>
        <hr className="h-0 flex-1 border-0 border-t border-gray-200" />
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          {formData.map(({ name, label, placeholder, type, description }) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label || "Label"}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={placeholder || "Placeholder"}
                      type={type || "text"}
                      {...field}
                    />
                  </FormControl>
                  {description && (
                    <FormDescription>{description}</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <Button type="submit" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} Continue
          </Button>
        </form>
      </Form>
    </>
  );
}
