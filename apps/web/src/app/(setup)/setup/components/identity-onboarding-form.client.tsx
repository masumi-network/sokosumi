"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { CreateOrganizationWizard } from "@/components/organizations";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate";
import { activateOrganizationWorkspace } from "@/lib/activate-organization-workspace";
import { authClient } from "@/lib/auth/auth.client";
import { type NameFormType, nameFormSchema } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type WorkspaceChoice = "personal" | "organization";

interface IdentityOnboardingFormProps {
  initialName: string;
}

export function IdentityOnboardingForm({
  initialName,
}: IdentityOnboardingFormProps) {
  const t = useTranslations("WorkspaceGate.Identity");
  const tSchema = useTranslations("Library.Auth.Schema");
  const router = useRouter();
  const [choice, setChoice] = useState<WorkspaceChoice>("personal");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<NameFormType>({
    resolver: zodResolver(nameFormSchema(tSchema)),
    defaultValues: {
      name: initialName,
    },
  });

  async function leaveGateAfterWorkspace(organizationId: string | null) {
    setSubmitting(true);
    try {
      await activateOrganizationWorkspace(organizationId);
    } catch (error) {
      console.error(
        organizationId === null
          ? "Identity onboarding personal activation failed"
          : "Identity onboarding organization activation failed",
        error,
      );

      if (organizationId !== null) {
        try {
          await activateOrganizationWorkspace(organizationId);
        } catch (retryError) {
          console.error(
            "Identity onboarding organization activation retry failed",
            retryError,
          );
          toast.error(t("organizationActivateError"));
        }
      }
    }
    router.replace("/");
    router.refresh();
  }

  async function persistDisplayName(name: string): Promise<boolean> {
    try {
      const updateUserResult = await authClient.updateUser({ name });
      if (updateUserResult.error) {
        toast.error(updateUserResult.error.message ?? t("nameUpdateError"));
        return false;
      }
      return true;
    } catch (error) {
      console.error("Identity onboarding name persist failed", error);
      toast.error(t("nameUpdateError"));
      return false;
    }
  }

  async function handlePersonalSubmit(values: NameFormType) {
    setSubmitting(true);
    try {
      if (!(await persistDisplayName(values.name))) {
        return;
      }

      const createResult = await createPersonalWorkspaceAction({});
      if (!createResult.ok) {
        if (
          createResult.error.code ===
          WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS
        ) {
          // Already ready — leave the gate instead of toasting create failure.
          await leaveGateAfterWorkspace(null);
          return;
        }
        console.error(
          "Identity onboarding personal create failed",
          createResult.error,
        );
        toast.error(t("personalCreateError"));
        return;
      }

      await leaveGateAfterWorkspace(null);
    } catch (error) {
      console.error("Identity onboarding personal create failed", error);
      toast.error(t("personalCreateError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOrganizationContinue(values: NameFormType) {
    setSubmitting(true);
    try {
      if (!(await persistDisplayName(values.name))) {
        return;
      }
      setWizardOpen(true);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSetupSubmit(values: NameFormType) {
    if (choice === "organization") {
      void handleOrganizationContinue(values);
      return;
    }

    void handlePersonalSubmit(values);
  }

  const { isSubmitting } = form.formState;
  const busy = submitting || isSubmitting;

  return (
    <>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSetupSubmit)}
          className="space-y-6"
          data-testid="workspace-gate-identity-form"
        >
          <fieldset className="space-y-6" disabled={busy}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("displayNameLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("displayNamePlaceholder")}
                      autoComplete="name"
                      data-testid="workspace-gate-identity-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3">
              <Label id="workspace-gate-choice-label">{t("choiceLabel")}</Label>
              <RadioGroup
                value={choice}
                onValueChange={(value) => {
                  if (value === "personal" || value === "organization") {
                    setChoice(value);
                  }
                }}
                aria-labelledby="workspace-gate-choice-label"
                className="grid gap-3"
                data-testid="workspace-gate-identity-choice"
              >
                <Label
                  htmlFor="workspace-choice-personal"
                  className={cn(
                    "border-input hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                    choice === "personal" && "border-primary bg-accent/30",
                  )}
                >
                  <RadioGroupItem
                    value="personal"
                    id="workspace-choice-personal"
                    className="mt-0.5"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">
                      {t("personalTitle")}
                    </span>
                    <span className="text-muted-foreground block text-sm font-normal">
                      {t("personalDescription")}
                    </span>
                  </span>
                </Label>
                <Label
                  htmlFor="workspace-choice-organization"
                  className={cn(
                    "border-input hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                    choice === "organization" && "border-primary bg-accent/30",
                  )}
                >
                  <RadioGroupItem
                    value="organization"
                    id="workspace-choice-organization"
                    className="mt-0.5"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">
                      {t("organizationTitle")}
                    </span>
                    <span className="text-muted-foreground block text-sm font-normal">
                      {t("organizationDescription")}
                    </span>
                  </span>
                </Label>
              </RadioGroup>
            </div>

            <Button
              type="submit"
              disabled={busy}
              className="w-full"
              data-testid="workspace-gate-identity-submit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {choice === "personal" ? t("createPersonal") : t("continue")}
            </Button>
          </fieldset>
        </form>
      </Form>
      <CreateOrganizationWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onOrganizationReady={(organizationId) => {
          void leaveGateAfterWorkspace(organizationId);
        }}
      />
    </>
  );
}
