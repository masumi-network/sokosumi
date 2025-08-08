"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import {
  AlertDialogCancel,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
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
import { authClient } from "@/lib/auth/auth.client";
import { RemoveOrganizationSchemaType } from "@/lib/schemas/organization";
import { Organization } from "@/prisma/generated/client";

interface OrganizationRemoveFormProps {
  organization: Organization;
  form: UseFormReturn<RemoveOrganizationSchemaType>;
}

export default function OrganizationRemoveForm({
  organization,
  form,
}: OrganizationRemoveFormProps) {
  const t = useTranslations("Components.Organizations.RemoveModal");
  const router = useRouter();

  const onSubmit = async (_values: RemoveOrganizationSchemaType) => {
    const result = await authClient.organization.delete({
      organizationId: organization.id,
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error");
      if (result.error.status === 401) {
        toast.error(errorMessage, {
          action: {
            label: t("Errors.unauthorizedAction"),
            onClick: async () => {
              router.push("/login");
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      toast.success(t("success"));
      router.push("/organizations");
    }
  };

  const canDelete = form.formState.isValid;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset
          disabled={form.formState.isSubmitting}
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="confirmName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("confirmLabelPrefix")} <strong>{organization.name}</strong>{" "}
                  {t("confirmLabelSuffix")}
                </FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={form.formState.isSubmitting}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={form.formState.isSubmitting || !canDelete}
            >
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("confirm")}
            </Button>
          </AlertDialogFooter>
        </fieldset>
      </form>
    </Form>
  );
}
