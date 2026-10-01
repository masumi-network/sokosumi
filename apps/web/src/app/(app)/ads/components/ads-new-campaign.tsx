"use client";

import type { ProjectAdProvider } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { createAdCampaign } from "@/lib/actions/ads/action";
import {
  AD_CAMPAIGN_OBJECTIVES,
  budgetStep,
  currencyFractionDigits,
  hasValidPrecision,
} from "@/lib/ads/campaign";

interface AdsNewCampaignProps {
  accountId: string;
  currency: string;
  projectId: string;
  provider: ProjectAdProvider;
}

type FieldErrors = Partial<
  Record<"name" | "dailyBudget" | "objective", string>
>;

/**
 * The form's rules, as Core states them: a name of 1 to 255 characters, a
 * budget above 0 within the currency's precision and, for Meta only, one
 * objective. Issue messages are codes the form words in the user's language.
 */
function campaignSchema(digits: number, needsObjective: boolean) {
  return z.object({
    name: z.string().trim().min(1, "nameRequired").max(255, "nameTooLong"),
    dailyBudget: z
      .number({ error: "budgetRequired" })
      .positive("budgetRequired")
      .refine((value) => hasValidPrecision(value, digits), "budgetPrecision"),
    objective: needsObjective
      ? z.enum(AD_CAMPAIGN_OBJECTIVES, { error: "objectiveRequired" })
      : z.undefined(),
  });
}

/**
 * "New campaign": a button and the sheet it opens, a side sheet on desktop
 * and a bottom sheet on mobile. Core creates the campaign paused; the action
 * revalidates the page, so the list refetches and nothing updates optimistically.
 */
export function AdsNewCampaign(props: AdsNewCampaignProps) {
  const t = useTranslations("App.Ads.campaigns.newCampaign");
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button">
        {t("button")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className={isMobile ? "max-h-[92dvh] overflow-y-auto" : undefined}
          side={isMobile ? "bottom" : "right"}
        >
          <SheetHeader className="pr-12">
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("note")}</SheetDescription>
          </SheetHeader>
          <NewCampaignForm {...props} onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function NewCampaignForm({
  accountId,
  currency,
  onClose,
  projectId,
  provider,
}: AdsNewCampaignProps & { onClose: () => void }) {
  const t = useTranslations("App.Ads.campaigns.newCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const digits = currencyFractionDigits(currency);
  const needsObjective = provider === "meta_ads";
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [objective, setObjective] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function precisionError(): string {
    return digits === 0
      ? t("errors.wholeNumber", { currency })
      : t("errors.precision", { digits, currency });
  }

  function worded(code: string): string {
    return code === "budgetPrecision" ? precisionError() : t(`errors.${code}`);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const parsed = campaignSchema(digits, needsObjective).safeParse({
      name,
      dailyBudget: budget.trim() === "" ? Number.NaN : Number(budget),
      objective: objective || undefined,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          (field === "name" ||
            field === "dailyBudget" ||
            field === "objective") &&
          !next[field]
        ) {
          next[field] = worded(issue.message);
        }
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setFormError(null);
    setIsSaving(true);
    try {
      const result = await createAdCampaign({
        projectId,
        accountId,
        ...parsed.data,
      });
      if (result.ok) {
        toast.success(t("success"));
        onClose();
      } else if (result.error.status === 422) {
        setErrors({ dailyBudget: precisionError() });
      } else if (result.error.status === 409) {
        setFormError(tCampaigns("errors.notActive.title"));
      } else {
        setFormError(t("errors.failed"));
      }
    } catch {
      setFormError(t("errors.failed"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="grid gap-5 px-4 pb-4"
      noValidate
      onSubmit={(event) => void handleSubmit(event)}
    >
      <Field error={errors.name} id="ads-campaign-name" label={t("name")}>
        <Input
          {...fieldProps("ads-campaign-name", errors.name)}
          autoComplete="off"
          maxLength={255}
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </Field>
      <Field
        error={errors.dailyBudget}
        id="ads-campaign-budget"
        label={t("budget", { currency })}
      >
        <Input
          {...fieldProps("ads-campaign-budget", errors.dailyBudget)}
          inputMode="decimal"
          min={0}
          onChange={(event) => setBudget(event.target.value)}
          step={budgetStep(digits)}
          type="number"
          value={budget}
        />
      </Field>
      {needsObjective ? (
        <Field
          error={errors.objective}
          id="ads-campaign-objective"
          label={t("objective")}
        >
          <Select onValueChange={setObjective} value={objective}>
            <SelectTrigger
              {...fieldProps("ads-campaign-objective", errors.objective)}
              className="w-full"
            >
              <SelectValue placeholder={t("objectivePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {AD_CAMPAIGN_OBJECTIVES.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {t(`objectives.${candidate}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {formError ? (
        <p className="text-destructive text-sm" role="alert">
          {formError}
        </p>
      ) : null}
      <SheetFooter className="flex-row justify-end p-0">
        <Button onClick={onClose} type="button" variant="ghost">
          {tCampaigns("cancel")}
        </Button>
        <Button disabled={isSaving} type="submit">
          {isSaving ? t("saving") : t("submit")}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** The id and error wiring a control needs to match its `Field`. */
function fieldProps(id: string, error: string | undefined) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  };
}

/** A label above a control, with the field's error beneath it. */
function Field({
  children,
  error,
  id,
  label,
}: {
  children: React.ReactNode;
  error: string | undefined;
  id: string;
  label: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-sm" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
