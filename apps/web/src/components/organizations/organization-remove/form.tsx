"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
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
import type {
  OrganizationDeletionEvaluation,
  OrganizationRecord,
} from "@/lib/clients/generated/core";
import {
  type RemoveOrganizationSchemaType,
  removeOrganizationSchema,
} from "@/lib/schemas/organization";

interface OrganizationRemoveFormProps {
  organization: OrganizationRecord;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  blockers?: OrganizationDeletionEvaluation["blockers"];
  preflightFailed?: boolean;
}

interface DeletionBlockerCopy {
  message: string;
  href?: string;
  linkLabel?: string;
}

function organizationDeletionBlockerCopy(
  code: string,
  t: ReturnType<typeof useTranslations>,
): DeletionBlockerCopy {
  if (code === ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE) {
    return { message: t("Errors.additionalMembers") };
  }
  if (code === LAST_WORKSPACE_ERROR_CODE) {
    return { message: t("Errors.lastWorkspace") };
  }
  if (code === RUNNING_SUBSCRIPTION_ERROR_CODE) {
    return { message: t("Errors.runningSubscription") };
  }
  if (code === ENTERPRISE_CONTRACT_ACTIVE_ERROR_CODE) {
    return { message: t("Errors.enterpriseContractActive") };
  }
  if (code === IN_FLIGHT_JOB_ERROR_CODE) {
    return {
      message: t("Errors.inFlightJob"),
      href: "/history",
      linkLabel: t("Links.jobs"),
    };
  }
  if (code === UNSETTLED_ON_CHAIN_JOB_ERROR_CODE) {
    return {
      message: t("Errors.unsettledOnChainJob"),
      href: "/history",
      linkLabel: t("Links.jobs"),
    };
  }
  if (code === IN_FLIGHT_TASK_ERROR_CODE) {
    return {
      message: t("Errors.inFlightTask"),
      href: "/tasks",
      linkLabel: t("Links.tasks"),
    };
  }
  return { message: t("error") };
}

function organizationDeletionBlockerHasBillingLink(code: string): boolean {
  return (
    code === RUNNING_SUBSCRIPTION_ERROR_CODE ||
    code === ENTERPRISE_CONTRACT_ACTIVE_ERROR_CODE
  );
}

function organizationDeletionBlockerMessage(
  code: string,
  t: ReturnType<typeof useTranslations>,
): string {
  return organizationDeletionBlockerCopy(code, t).message;
}

export default function OrganizationRemoveForm({
  organization,
  setIsLoading,
  onOpenChange,
  blockers = [],
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
              router.push("/login");
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
  const confirmDisabled =
    isSubmitting || !isValid || blockers.length > 0 || preflightFailed;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
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
          {blockers.length > 0 ? (
            <div className="space-y-2">
              <p className="text-destructive text-sm">{t("blockersTitle")}</p>
              <ul className="text-destructive list-disc space-y-1 pl-5 text-sm">
                {blockers.map((code) => {
                  const copy = organizationDeletionBlockerCopy(code, t);
                  return (
                    <li key={code}>
                      {copy.message}
                      {copy.href && copy.linkLabel ? (
                        <>
                          {" "}
                          <Link href={copy.href} className="underline">
                            {copy.linkLabel}
                          </Link>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {blockers.some(organizationDeletionBlockerHasBillingLink) ? (
                <Link
                  href="/billing"
                  className="text-destructive text-sm underline underline-offset-2"
                >
                  {t("Errors.billingLink")}
                </Link>
              ) : null}
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
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={confirmDisabled}
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
