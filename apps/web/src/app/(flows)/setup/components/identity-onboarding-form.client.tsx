"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Temporary registration policy. Organization setup remains implemented below
 * so re-enabling it later only requires changing this default.
 */
const ORGANIZATION_SETUP_ENABLED = false;

interface IdentityOnboardingFormProps {
  initialName: string;
  workspaceReady: boolean;
  /** Keeps the dormant organization path covered while its UI is disabled. */
  organizationSetupEnabled?: boolean;
}

export function IdentityOnboardingForm({
  initialName,
  workspaceReady,
  organizationSetupEnabled = ORGANIZATION_SETUP_ENABLED,
}: IdentityOnboardingFormProps) {
  const t = useTranslations("WorkspaceGate.Identity");
  const tSchema = useTranslations("Library.Auth.Schema");
  const [choice, setChoice] = useState<WorkspaceChoice>("personal");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const leavingGateRef = useRef(false);

  const form = useForm<NameFormType>({
    resolver: zodResolver(nameFormSchema(tSchema)),
    defaultValues: {
      name: initialName,
    },
  });

  const leaveToApp = useCallback(() => {
    // activateOrganizationWorkspace persists preferred org via a server
    // action, which refreshes the current URL. Soft router.replace +
    // refresh remounts /setup and cancels the leave. replace (not assign)
    // keeps /setup off the history stack so Back does not bounce-loop.
    window.location.replace("/");
  }, []);

  useEffect(() => {
    if (!workspaceReady || wizardOpen || leavingGateRef.current) {
      return;
    }
    leaveToApp();
  }, [workspaceReady, wizardOpen, leaveToApp]);

  async function leaveGateAfterWorkspace(organizationId: string | null) {
    leavingGateRef.current = true;
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
    leaveToApp();
  }

  async function persistDisplayName(name: string): Promise<boolean> {
    if (name.trim() === initialName.trim()) {
      return true;
    }

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
    if (choice === "organization" && organizationSetupEnabled) {
      void handleOrganizationContinue(values);
      return;
    }

    void handlePersonalSubmit(values);
  }

  const { isSubmitting } = form.formState;
  const busy = submitting || isSubmitting;

  const showIdentityFields = !workspaceReady;

  return (
    <>
      {showIdentityFields ? (
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
                    <FormLabel>{t("nameLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("namePlaceholder")}
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
                <RadioGroup
                  value={choice}
                  onValueChange={(value) => {
                    if (
                      value === "personal" ||
                      (organizationSetupEnabled && value === "organization")
                    ) {
                      setChoice(value);
                    }
                  }}
                  aria-label={t("choiceLabel")}
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
                    aria-disabled={!organizationSetupEnabled}
                    className={cn(
                      "border-input flex items-start gap-3 rounded-lg border p-4",
                      organizationSetupEnabled
                        ? "hover:bg-accent/40 cursor-pointer"
                        : "cursor-not-allowed opacity-60",
                      choice === "organization" &&
                        "border-primary bg-accent/30",
                    )}
                  >
                    <RadioGroupItem
                      value="organization"
                      id="workspace-choice-organization"
                      disabled={!organizationSetupEnabled}
                      className="mt-0.5"
                    />
                    <span className="space-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {t("organizationTitle")}
                        </span>
                        {!organizationSetupEnabled ? (
                          <span className="text-muted-foreground text-xs font-normal">
                            {t("organizationUnavailable")}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground block text-sm font-normal">
                        {t("organizationDescription")}
                      </span>
                    </span>
                  </Label>
                </RadioGroup>
                <p className="text-muted-foreground text-sm">
                  {t("choiceHint")}
                </p>
              </div>

              <Button
                type="submit"
                disabled={busy}
                className="w-full"
                data-testid="workspace-gate-identity-submit"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("continue")}
              </Button>
            </fieldset>
          </form>
        </Form>
      ) : (
        <div
          className="flex justify-center py-6"
          data-testid="workspace-gate-leaving"
        >
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
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
