"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import { useForm } from "react-hook-form";
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
import {
  LAST_WORKSPACE_ERROR_CODE,
  ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE,
} from "@/lib/actions/errors/better-auth";
import { authClient } from "@/lib/auth/auth.client";
import type { OrganizationRecord } from "@/lib/clients/generated/core";
import {
  type RemoveOrganizationSchemaType,
  removeOrganizationSchema,
} from "@/lib/schemas/organization";

interface OrganizationRemoveFormProps {
  organization: OrganizationRecord;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export default function OrganizationRemoveForm({
  organization,
  setIsLoading,
  onOpenChange,
}: OrganizationRemoveFormProps) {
  const t = useTranslations("Components.Organizations.RemoveModal");
  const router = useRouter();

  const form = useForm<RemoveOrganizationSchemaType>({
    resolver: zodResolver(
      removeOrganizationSchema(
        organization.name,
        useTranslations("Components.Organizations.RemoveModal.Schema"),
      ),
    ),
    defaultValues: {
      confirmName: "",
    },
  });

  const onSubmit = async (_: RemoveOrganizationSchemaType) => {
    setIsLoading(true);
    const result = await authClient.organization.delete({
      organizationId: organization.id,
    });
    if (result.error) {
      const errorMessage =
        result.error.code === ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE
          ? t("Errors.additionalMembers")
          : result.error.code === LAST_WORKSPACE_ERROR_CODE
            ? t("Errors.lastWorkspace")
            : (result.error.message ?? t("error"));
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
      router.push("/");
      router.refresh();
      onOpenChange(false);
    }
    setIsLoading(false);
  };

  const { isSubmitting, isValid } = form.formState;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset disabled={isSubmitting} className="flex flex-col gap-4">
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
            <AlertDialogCancel disabled={isSubmitting}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={isSubmitting || !isValid}
            >
              {isSubmitting && (
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
