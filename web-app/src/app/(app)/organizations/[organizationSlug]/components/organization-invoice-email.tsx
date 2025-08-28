"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { CommonErrorCode, updateOrganizationInvoiceEmail } from "@/lib/actions";
import { MemberRole, OrganizationWithRelations } from "@/lib/db";
import { Member } from "@/prisma/generated/client";

const invoiceEmailFormSchema = z.object({
  invoiceEmail: z
    .email()
    .or(z.literal(""))
    .transform((val) => (val === "" ? null : val))
    .nullable(),
});
type InvoiceEmailFormData = z.infer<typeof invoiceEmailFormSchema>;

interface OrganizationInvoiceEmailProps {
  organization: OrganizationWithRelations;
  member: Member;
}

export default function OrganizationInvoiceEmail({
  organization,
  member,
}: OrganizationInvoiceEmailProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.InvoiceEmail",
  );
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);

  const { role } = member;
  const isOwnerOrAdmin = role === MemberRole.OWNER || role === MemberRole.ADMIN;

  const form = useForm<InvoiceEmailFormData>({
    resolver: zodResolver(invoiceEmailFormSchema),
    defaultValues: {
      invoiceEmail: organization.invoiceEmail ?? "",
    },
  });

  useEffect(() => {
    form.reset({
      invoiceEmail: organization.invoiceEmail ?? "",
    });
  }, [organization.invoiceEmail, form]);

  const onSubmit = async (data: InvoiceEmailFormData) => {
    const result = await updateOrganizationInvoiceEmail({
      organizationId: organization.id,
      invoiceEmail: data.invoiceEmail,
    });

    if (result.ok) {
      toast.success(t("Success.update"));
      setIsEditing(false);
      router.refresh();
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: async () => {
                router.push("/login");
              },
            },
          });
          break;
        case CommonErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        case CommonErrorCode.BAD_INPUT:
          toast.error(result.error.message ?? t("Errors.badInput"));
          break;
        default:
          toast.error(t("Errors.general"));
      }
    }
  };

  const handleCancel = () => {
    form.reset({
      invoiceEmail: organization.invoiceEmail ?? "",
    });
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          <CardTitle>{t("title")}</CardTitle>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="invoiceEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("label")}</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder={t("placeholder")}
                        disabled={!isEditing || form.formState.isSubmitting}
                        {...field}
                        value={field.value ?? ""}
                      />
                      {!isEditing ? (
                        isOwnerOrAdmin && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsEditing(true)}
                          >
                            {t("edit")}
                          </Button>
                        )
                      ) : (
                        <>
                          <Button
                            type="submit"
                            disabled={form.formState.isSubmitting}
                          >
                            {form.formState.isSubmitting && (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            {t("save")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancel}
                            disabled={form.formState.isSubmitting}
                          >
                            {t("cancel")}
                          </Button>
                        </>
                      )}
                    </div>
                  </FormControl>
                  <FormDescription>{t("help")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
