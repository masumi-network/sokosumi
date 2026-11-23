"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { OrganizationRecord } from "@sokosumi/core-client";
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
  ENTERPRISE_CONTRACT_ACTIVE_ERROR_CODE,
  IN_FLIGHT_JOB_ERROR_CODE,
  IN_FLIGHT_TASK_ERROR_CODE,
  LAST_WORKSPACE_ERROR_CODE,
  ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE,
  RUNNING_SUBSCRIPTION_ERROR_CODE,
  UNSETTLED_ON_CHAIN_JOB_ERROR_CODE,
} from "@/lib/actions/errors/better-auth";
import { authClient } from "@/lib/auth/auth.client";
import {
  type RemoveOrganizationSchemaType,
  removeOrganizationSchema,
} from "@/lib/schemas/organization";

interface OrganizationRemoveFormProps {
  organization: OrganizationRecord;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  preflightFailed?: boolean;
}

// Core re-checks every blocker on submit; these map a late refusal to a toast.
const DELETION_ERROR_KEYS: Record<string, string> = {
  [ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE]: "Errors.additionalMembers",
  [LAST_WORKSPACE_ERROR_CODE]: "Errors.lastWorkspace",
  [RUNNING_SUBSCRIPTION_ERROR_CODE]: "Errors.runningSubscription",
  [ENTERPRISE_CONTRACT_ACTIVE_ERROR_CODE]: "Errors.enterpriseContractActive",
  [IN_FLIGHT_JOB_ERROR_CODE]: "Errors.inFlightJob",
  [UNSETTLED_ON_CHAIN_JOB_ERROR_CODE]: "Errors.unsettledOnChainJob",
  [IN_FLIGHT_TASK_ERROR_CODE]: "Errors.inFlightTask",
};

function organizationDeletionBlockerMessage(
  code: string,
  t: ReturnType<typeof useTranslations>,
): string {
  return t(DELETION_ERROR_KEYS[code] ?? "error");
}

export default function OrganizationRemoveForm({
  organization,
  setIsLoading,
  onOpenChange,
  preflightFailed = false,
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
      const errorMessage = organizationDeletionBlockerMessage(
        result.error.code ?? "",
        t,
      );
      const resolvedErrorMessage =
        errorMessage === t("error")
          ? (result.error.message ?? t("error"))
          : errorMessage;
      if (result.error.status === 401) {
        toast.error(resolvedErrorMessage, {
          action: {
            label: t("Errors.unauthorizedAction"),
            onClick: async () => {
              router.push("/signin");
            },
          },
        });
      } else {
        toast.error(resolvedErrorMessage);
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
  const confirmDisabled = !isValid || preflightFailed;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <fieldset disabled={isSubmitting} className="flex flex-col gap-4">
          {preflightFailed ? (
            <div className="space-y-2">
              <p className="text-destructive text-sm">{t("preflightError")}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.refresh()}
              >
                {t("retry")}
              </Button>
            </div>
          ) : null}
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
        </fieldset>
        {/* Outside the fieldset: a disabled fieldset would natively
            disable the button and fade its loading bar. */}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {t("cancel")}
          </AlertDialogCancel>
          <Button
            type="submit"
            variant="destructive"
            disabled={confirmDisabled}
            loading={isSubmitting}
          >
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </form>
    </Form>
  );
}
