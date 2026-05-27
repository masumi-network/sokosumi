"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/auth.client";

const createOAuthClientSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be less than 100 characters"),
  redirectUris: z
    .string()
    .min(1, "At least one redirect URI is required")
    .refine(
      (value) => {
        const uris = value
          .split("\n")
          .map((uri) => uri.trim())
          .filter((uri) => uri.length > 0);
        return (
          uris.length > 0 &&
          uris.every((uri) => {
            try {
              new URL(uri);
              return true;
            } catch {
              return false;
            }
          })
        );
      },
      {
        message: "Each redirect URI must be a valid URL",
      },
    ),
});

type CreateOAuthClientFormData = z.infer<typeof createOAuthClientSchema>;

export default function CreateOAuthClientPage() {
  const t = useTranslations("App.Account.OAuthClients");
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdClient, setCreatedClient] = useState<{
    clientId: string;
    clientSecret: string | null;
  } | null>(null);

  const form = useForm<CreateOAuthClientFormData>({
    resolver: zodResolver(createOAuthClientSchema),
    defaultValues: {
      name: "",
      redirectUris: "",
    },
  });

  const onSubmit = async (values: CreateOAuthClientFormData) => {
    setIsSubmitting(true);
    try {
      const redirectUris = values.redirectUris
        .split("\n")
        .map((uri) => uri.trim())
        .filter((uri) => uri.length > 0);

      const result = await authClient.oauth2.createClient({
        redirect_uris: redirectUris,
        client_name: values.name,
        scope: "openid",
      });

      if (result.error) {
        throw new Error(result.error.message || t("createError"));
      }

      if (result.data) {
        setCreatedClient({
          clientId: result.data.client_id,
          clientSecret: result.data.client_secret || null,
        });
        toast.success(t("createSuccess"));
        form.reset();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t("createError");
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = (value: string, label: string) => {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied to clipboard`);
  };

  const handleDone = () => {
    router.push("/account");
  };

  return (
    <div className="container mx-auto max-w-md py-8">
      <Card>
        {createdClient ? (
          <>
            <CardHeader>
              <CardTitle>{t("CreatedSuccess.title")}</CardTitle>
              <CardDescription>
                {t("CreatedSuccess.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">
                  {t("CreatedSuccess.clientIdLabel")}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    value={createdClient.clientId}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleCopy(
                        createdClient.clientId,
                        t("CreatedSuccess.clientIdLabel"),
                      )
                    }
                  >
                    {t("copy")}
                  </Button>
                </div>
              </div>

              {createdClient.clientSecret && (
                <div>
                  <label className="text-sm font-medium">
                    {t("CreatedSuccess.clientSecretLabel")}
                  </label>
                  <p className="text-muted-foreground mb-2 text-xs">
                    {t("CreatedSuccess.clientSecretWarning")}
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      value={createdClient.clientSecret}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleCopy(
                          createdClient.clientSecret!,
                          t("CreatedSuccess.clientSecretLabel"),
                        )
                      }
                    >
                      {t("copy")}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <Button onClick={handleDone}>
                  {t("CreatedSuccess.doneButton")}
                </Button>
              </div>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>{t("CreateDialog.title")}</CardTitle>
              <CardDescription>{t("CreateDialog.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("CreateDialog.nameLabel")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("CreateDialog.namePlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="redirectUris"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("CreateDialog.redirectUrisLabel")}
                        </FormLabel>
                        <FormControl>
                          <textarea
                            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder={t(
                              "CreateDialog.redirectUrisPlaceholder",
                            )}
                            {...field}
                          />
                        </FormControl>
                        <p className="text-muted-foreground text-xs">
                          {t("CreateDialog.redirectUrisHelp")}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.back()}
                      disabled={isSubmitting}
                    >
                      {t("CreateDialog.cancelButton")}
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {t("CreateDialog.createButton")}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
