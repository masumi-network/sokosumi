"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { ActionResultDto } from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { AD_CAMPAIGN_NAME_MAX_LENGTH } from "@/lib/ads/campaign";
import {
  GOOGLE_DISPLAY_LIMITS,
  googleDisplayFormSchema,
} from "@/lib/ads/google-display";
import {
  GOOGLE_KEYWORD_LIMIT,
  GOOGLE_KEYWORD_MAX_LENGTH,
  GOOGLE_KEYWORD_MAX_WORDS,
} from "@/lib/ads/google-keywords";
import {
  GOOGLE_SEARCH_LIMITS,
  googleSearchFormSchema,
} from "@/lib/ads/google-search";
import type { GoogleTargeting } from "@/lib/ads/targeting";
import { useAdsBudget } from "./ads-budget";

export interface CampaignFormProps {
  accountId: string;
  currency: string;
  projectId: string;
}

export interface GoogleCampaignFormProps extends CampaignFormProps {
  /** Whether the project has a Market profile, which "Add from Market" reads. */
  hasMarketProfile: boolean;
  /** The languages to pick from and the Market profile's suggestions. */
  targeting: GoogleTargeting;
}

/** Why the last attempt failed, and which attempt it was (to re-focus). */
interface Refusal {
  attempt: number;
  kind: "reconnect" | "failed" | "refused";
  /** Core's text, for a `refused` attempt. */
  message?: string;
}

interface BasicsValues {
  name: string;
  dailyBudget: string;
}

type SaveOutcome = "ok" | "budget_refused" | "shown";

export interface SaveCampaignOptions {
  success: { message: string; onSaved: () => void };
  /** Meta create maps 422 to the budget field (our precision copy). */
  budgetPrecisionOn422?: boolean;
  /** Words for a refusal Core's own text does not serve (an edit's 409). */
  explain?: (error: ActionError) => string | undefined;
  /** Takes the form back to its start after a save, once Next shows it again. */
  onStartOver?: () => void;
}

/**
 * Sends the campaign and follows the outcome. Core answers the create and the
 * edit alike, and the action revalidates the pages, so nothing updates
 * optimistically.
 *
 * Google keeps Core's/Google's message for a 422 in the alert.
 */
export function useSaveCampaign({
  success,
  budgetPrecisionOn422 = false,
  explain,
  onStartOver,
}: SaveCampaignOptions) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [saved, setSaved] = useState(false);
  const savedRef = useRef(false);

  // Next keeps a visited page mounted but hidden and re-runs its effects when
  // it shows again. After a save, the page starts over (a create empty, an
  // edit as it was); an unsent draft stays.
  useMountEffect(() => {
    if (!savedRef.current) return;
    savedRef.current = false;
    setSaved(false);
    onStartOver?.();
  });

  async function save(
    send: () => Promise<ActionResultDto<unknown, ActionError>>,
  ): Promise<SaveOutcome> {
    setRefusal(null);
    const attempt = (refusal?.attempt ?? 0) + 1;
    try {
      const result = await send();
      if (result.ok) {
        toast.success(success.message);
        savedRef.current = true;
        setSaved(true);
        success.onSaved();
        return "ok";
      }
      if (result.error.status === 422) {
        if (budgetPrecisionOn422) return "budget_refused";
        if (result.error.message) {
          setRefusal({
            attempt,
            kind: "refused",
            message: result.error.message,
          });
          return "shown";
        }
      }
      const explanation = explain?.(result.error);
      if (explanation) {
        setRefusal({ attempt, kind: "refused", message: explanation });
        return "shown";
      }
      setRefusal({
        attempt,
        kind: result.error.status === 409 ? "reconnect" : "failed",
      });
      return "shown";
    } catch {
      setRefusal({ attempt, kind: "failed" });
      return "shown";
    }
  }

  return { refusal, saved, save };
}

/** Pulls focus (and the view) up from the submit button far below. */
export function RefusalAlert({
  failedTitle,
  projectId,
  refusal,
}: {
  failedTitle: string;
  projectId: string;
  refusal: Refusal;
}) {
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const ref = useRef<HTMLDivElement>(null);
  useMountEffect(() => ref.current?.focus());

  const { title, description } = {
    failed: { title: failedTitle, description: null },
    refused: {
      title: failedTitle,
      description: <p>{refusal.message}</p>,
    },
    reconnect: {
      title: tCampaigns("errors.notActive.title"),
      description: (
        <Link
          className="underline"
          href={`/ads?${new URLSearchParams({ projectId, tab: "accounts" })}`}
        >
          {tCampaigns("errors.notActive.action")}
        </Link>
      ),
    },
  }[refusal.kind];

  return (
    <Alert ref={ref} tabIndex={-1} variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

/** The name and daily budget, which every campaign has. */
export function useBasics(currency: string) {
  const t = useTranslations("App.Ads.newCampaign");
  const budget = useAdsBudget(currency);
  const shape = {
    name: z
      .string()
      .trim()
      .min(1, t("errors.nameRequired"))
      .max(
        AD_CAMPAIGN_NAME_MAX_LENGTH,
        t("errors.nameTooLong", { max: AD_CAMPAIGN_NAME_MAX_LENGTH }),
      ),
    dailyBudget: budget.schema,
  };
  return { budget, shape };
}

export function NameAndBudgetFields({
  budget,
}: {
  budget: ReturnType<typeof useAdsBudget>;
}) {
  const t = useTranslations("App.Ads.newCampaign");
  const form = useFormContext<BasicsValues>();

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("name")}</FormLabel>
            <FormControl>
              <Input
                autoComplete="off"
                maxLength={AD_CAMPAIGN_NAME_MAX_LENGTH}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="dailyBudget"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{budget.label}</FormLabel>
            <FormControl>
              <Input
                inputMode="decimal"
                min={0}
                step={budget.step}
                type="number"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

/** The form's schema, which judges only the chosen type, and the budget's words. */
export function useGoogleFormSchema(currency: string) {
  const t = useTranslations("App.Ads.newCampaign");
  const { budget, shape } = useBasics(currency);
  const common = {
    finalUrl: t("errors.finalUrl"),
    headlineRequired: t("errors.headlineRequired"),
    headlineDuplicate: t("errors.headlineDuplicate"),
    descriptionRequired: t("errors.descriptionRequired"),
    tooLong: (max: number) => t("errors.tooLong", { max }),
    endBeforeStart: t("errors.endBeforeStart"),
  };
  const tooLongOf = (limits: {
    headlines: { length: number };
    descriptions: { length: number };
  }) => ({
    headlineTooLong: t("errors.headlineTooLong", {
      max: limits.headlines.length,
    }),
    descriptionTooLong: t("errors.descriptionTooLong", {
      max: limits.descriptions.length,
    }),
  });
  // The form holds the fields of both types; only the chosen type is judged.
  const schema = z.discriminatedUnion("type", [
    googleSearchFormSchema({
      ...common,
      ...tooLongOf(GOOGLE_SEARCH_LIMITS),
      pathNeedsFirst: t("errors.pathNeedsFirst"),
      sitelinkTextRequired: t("errors.sitelinkTextRequired"),
      sitelinkDescriptionsPair: t("errors.sitelinkDescriptionsPair"),
      sitelinkDuplicate: t("errors.sitelinkDuplicate"),
      calloutDuplicate: t("errors.calloutDuplicate"),
      keywordsRequired: t("keywords.errors.required"),
      keywordsTooMany: t("keywords.errors.tooMany", {
        max: GOOGLE_KEYWORD_LIMIT,
      }),
      keywordsInvalid: (line, issue) =>
        t(`keywords.errors.${issue}`, {
          line,
          max:
            issue === "tooLong"
              ? GOOGLE_KEYWORD_MAX_LENGTH
              : GOOGLE_KEYWORD_MAX_WORDS,
        }),
    }).safeExtend({ ...shape, type: z.literal("SEARCH") }),
    googleDisplayFormSchema({
      ...common,
      ...tooLongOf(GOOGLE_DISPLAY_LIMITS),
      businessNameRequired: t("errors.businessNameRequired"),
      longHeadlineRequired: t("errors.longHeadlineRequired"),
      imagesMissing: (missing) => t(`ad.images.missing.${missing}`),
      imagesTooMany: (max) => t("ad.images.errors.full", { maxImages: max }),
      logosTooMany: (max) => t("ad.images.errors.fullLogo", { maxLogos: max }),
      imageRepeated: t("ad.images.errors.repeated"),
    }).safeExtend({ ...shape, type: z.literal("DISPLAY") }),
  ]);
  return { budget, schema };
}

/** What the Google form submits once its fields are judged. */
export type GoogleFormOutput = z.output<
  ReturnType<typeof useGoogleFormSchema>["schema"]
>;
