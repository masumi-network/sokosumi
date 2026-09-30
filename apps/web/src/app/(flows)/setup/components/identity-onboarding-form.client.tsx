"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FirstAndLastNameFields } from "@/components/auth/first-and-last-name-fields";
import { CreateOrganizationWizard } from "@/components/organizations/create-organization-wizard/create-organization-wizard";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors/error-codes/workspace-gate";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate/action";
import { activateOrganizationWorkspace } from "@/lib/activate-organization-workspace";
import { persistFirstAndLastName } from "@/lib/auth/persist-user-name";
import {
  type FirstAndLastNameFormType,
  firstAndLastNameFormSchema,
} from "@/lib/schemas/account";
import { cn } from "@/lib/utils";

type WorkspaceChoice = "personal" | "organization";

interface IdentityOnboardingFormProps {
  initialName: string;
  initialFirstName: string;
  initialLastName: string;
  collectNameParts?: boolean;
  workspaceReady: boolean;
}

export function IdentityOnboardingForm({
  initialName,
  initialFirstName,
  initialLastName,
  collectNameParts = true,
  workspaceReady,
}: IdentityOnboardingFormProps) {
  const t = useTranslations("WorkspaceGate.Identity");
  const tSchema = useTranslations("Library.Auth.Schema");
  const [choice, setChoice] = useState<WorkspaceChoice>("personal");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const leavingGateRef = useRef(false);

  const form = useForm<FirstAndLastNameFormType>({
    resolver: collectNameParts
      ? zodResolver(firstAndLastNameFormSchema(tSchema))
      : undefined,
    defaultValues: {
      firstName: initialFirstName,
      lastName: initialLastName,
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

  async function persistNames(
    values: FirstAndLastNameFormType,
  ): Promise<boolean> {
    if (
      !collectNameParts ||
      (values.firstName === initialFirstName &&
        values.lastName === initialLastName)
    ) {
      return true;
    }

    const result = await persistFirstAndLastName(values, initialName);
    if (result.isErr()) {
      toast.error(result.error ?? t("nameUpdateError"));
      return false;
    }
    return true;
  }

  async function handlePersonalSubmit(values: FirstAndLastNameFormType) {
    setSubmitting(true);
    try {
      if (!(await persistNames(values))) {
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

  async function handleOrganizationContinue(values: FirstAndLastNameFormType) {
    setSubmitting(true);
    try {
      if (!(await persistNames(values))) {
        return;
      }
      setWizardOpen(true);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSetupSubmit(values: FirstAndLastNameFormType) {
    if (choice === "organization") {
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
              {collectNameParts ? (
                <FirstAndLastNameFields
                  control={form.control}
                  testIdPrefix="workspace-gate-identity"
                />
              ) : null}

              <div className="space-y-3">
                <RadioGroup
                  value={choice}
                  onValueChange={(value) => {
                    if (value === "personal" || value === "organization") {
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
                      "border-input press hover:bg-card-background flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                      choice === "personal" &&
                        "border-primary bg-card-background",
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
                      "border-input press hover:bg-card-background flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                      choice === "organization" &&
                        "border-primary bg-card-background",
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
                {busy ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
                ) : null}
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
          <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
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
