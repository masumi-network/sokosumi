"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { activateOrganizationWorkspace } from "@/app/components/user-avatar/workspace-switcher";
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
import { authClient } from "@/lib/auth/auth.client";
import { type NameFormType, nameFormSchema } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type WorkspaceChoice = "personal" | "organization";
type IdentityView = "setup" | "organization-placeholder";

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
  const [view, setView] = useState<IdentityView>("setup");
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<NameFormType>({
    resolver: zodResolver(nameFormSchema(tSchema)),
    defaultValues: {
      name: initialName,
    },
  });

  async function leaveGateAfterPersonalWorkspace() {
    try {
      await activateOrganizationWorkspace(null);
    } catch (error) {
      console.error("Identity onboarding personal activation failed", error);
    }
    router.replace("/");
    router.refresh();
  }

  async function handlePersonalSubmit(values: NameFormType) {
    setSubmitting(true);
    try {
      const updateUserResult = await authClient.updateUser({
        name: values.name,
      });

      if (updateUserResult.error) {
        toast.error(updateUserResult.error.message ?? t("nameUpdateError"));
        return;
      }

      const createResult = await createPersonalWorkspaceAction({});
      if (!createResult.ok) {
        if (
          createResult.error.code ===
          WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS
        ) {
          // Already ready — leave the gate instead of toasting create failure.
          await leaveGateAfterPersonalWorkspace();
          return;
        }
        toast.error(createResult.error.message ?? t("personalCreateError"));
        return;
      }

      await leaveGateAfterPersonalWorkspace();
    } catch (error) {
      console.error("Identity onboarding personal create failed", error);
      toast.error(t("personalCreateError"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSetupSubmit(values: NameFormType) {
    if (choice === "organization") {
      setView("organization-placeholder");
      return;
    }

    void handlePersonalSubmit(values);
  }

  if (view === "organization-placeholder") {
    return (
      <div
        className="space-y-4"
        data-testid="workspace-gate-identity-org-placeholder"
      >
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">
            {t("organizationPlaceholderTitle")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("organizationPlaceholderBody")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setView("setup")}
          data-testid="workspace-gate-identity-back"
        >
          {t("back")}
        </Button>
      </div>
    );
  }

  const { isSubmitting } = form.formState;
  const busy = submitting || isSubmitting;

  return (
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
  );
}
