"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ProjectAdProvider } from "@sokosumi/core-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAdCampaign } from "@/lib/actions/ads/action";
import { AD_CAMPAIGN_OBJECTIVES } from "@/lib/ads/campaign";
import {
  GOOGLE_KEYWORD_LIMIT,
  GOOGLE_KEYWORD_MAX_LENGTH,
  GOOGLE_KEYWORD_MAX_WORDS,
} from "@/lib/ads/google-keywords";
import {
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchFormValues,
  googleSearchFormSchema,
  toGoogleSearchSpec,
} from "@/lib/ads/google-search";
import { useAdsBudget } from "./ads-budget";
import {
  AdsGoogleDateFields,
  AdsGoogleSearchFields,
} from "./ads-google-search-fields";

interface AdsNewCampaignFormProps {
  accountId: string;
  currency: string;
  /** The project's Market keywords for "Add from Market"; null for Meta. */
  marketKeywords: Promise<string[]> | null;
  projectId: string;
  provider: ProjectAdProvider;
}

interface NewCampaignValues extends GoogleSearchFormValues {
  name: string;
  dailyBudget: string;
  objective: string;
}

/** Why the last attempt failed, and which attempt it was (to re-focus). */
type Refusal =
  | { attempt: number; kind: "reconnect" | "failed" }
  | { attempt: number; kind: "refused"; message: string };

const EMPTY_VALUES: NewCampaignValues = {
  name: "",
  dailyBudget: "",
  objective: "",
  startDate: "",
  endDate: "",
  keywords: "",
  finalUrl: "",
  path1: "",
  path2: "",
  headlines: Array.from(
    { length: GOOGLE_SEARCH_LIMITS.headlines.min },
    () => "",
  ),
  descriptions: Array.from(
    { length: GOOGLE_SEARCH_LIMITS.descriptions.min },
    () => "",
  ),
};

/**
 * The create page's form. The rules are Core's: a name of 1 to 255
 * characters, a budget above 0 within the currency's precision and, for
 * Meta, one objective; for Google, a Search campaign with dates, keywords and
 * a responsive search ad. Core creates the campaign paused; the action
 * revalidates the list, so nothing updates optimistically.
 */
export function AdsNewCampaignForm({
  accountId,
  currency,
  marketKeywords,
  projectId,
  provider,
}: AdsNewCampaignFormProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const router = useRouter();
  const budget = useAdsBudget(currency);
  const isGoogle = provider === "google_ads";
  const campaignsHref = `/ads?${new URLSearchParams({ projectId, tab: "campaigns", account: accountId })}`;
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [created, setCreated] = useState(false);

  const base = z.object({
    name: z
      .string()
      .trim()
      .min(1, t("errors.nameRequired"))
      .max(255, t("errors.nameTooLong")),
    dailyBudget: budget.schema,
    objective: isGoogle
      ? z.string()
      : z.string().min(1, t("errors.objectiveRequired")),
  });
  const schema = isGoogle
    ? z.intersection(
        base,
        googleSearchFormSchema({
          finalUrl: t("errors.finalUrl"),
          headlineRequired: t("errors.headlineRequired"),
          headlineTooLong: t("errors.headlineTooLong", {
            max: GOOGLE_SEARCH_LIMITS.headlines.length,
          }),
          headlineDuplicate: t("errors.headlineDuplicate"),
          descriptionRequired: t("errors.descriptionRequired"),
          descriptionTooLong: t("errors.descriptionTooLong", {
            max: GOOGLE_SEARCH_LIMITS.descriptions.length,
          }),
          pathTooLong: t("errors.pathTooLong", {
            max: GOOGLE_SEARCH_LIMITS.path,
          }),
          pathNeedsFirst: t("errors.pathNeedsFirst"),
          endBeforeStart: t("errors.endBeforeStart"),
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
        }),
      )
    : base;

  const form = useForm<NewCampaignValues>({
    // Meta's schema leaves the Search fields alone, so the resolver's output
    // is narrower than the form's values.
    resolver: zodResolver(schema) as unknown as Resolver<NewCampaignValues>,
    mode: "onTouched",
    defaultValues: EMPTY_VALUES,
  });

  async function handleSubmit(values: NewCampaignValues): Promise<void> {
    setRefusal(null);
    const campaign = {
      projectId,
      accountId,
      name: values.name,
      dailyBudget: Number(values.dailyBudget),
    };
    const attempt = (refusal?.attempt ?? 0) + 1;
    try {
      const result = await createAdCampaign(
        isGoogle
          ? { ...campaign, google: toGoogleSearchSpec(values) }
          : {
              ...campaign,
              objective: AD_CAMPAIGN_OBJECTIVES.find(
                (candidate) => candidate === values.objective,
              ),
            },
      );
      if (result.ok) {
        toast.success(t("success"));
        setCreated(true);
        router.push(campaignsHref);
      } else if (result.error.status === 422 && result.error.message) {
        setRefusal({ attempt, kind: "refused", message: result.error.message });
      } else {
        setRefusal({
          attempt,
          kind: result.error.status === 409 ? "reconnect" : "failed",
        });
      }
    } catch {
      setRefusal({ attempt, kind: "failed" });
    }
  }

  const accountsParams = new URLSearchParams({ projectId, tab: "accounts" });

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-10"
        noValidate
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        {refusal ? (
          // A new key per attempt re-mounts the alert, which pulls focus (and
          // the view) up to it from the submit button far below.
          <Alert
            key={refusal.attempt}
            ref={(node: HTMLDivElement | null) => node?.focus()}
            tabIndex={-1}
            variant="destructive"
          >
            <AlertTitle>
              {refusal.kind === "refused"
                ? t("errors.refusedTitle")
                : refusal.kind === "reconnect"
                  ? tCampaigns("errors.notActive.title")
                  : t("errors.failed")}
            </AlertTitle>
            <AlertDescription>
              {refusal.kind === "refused" ? (
                <p>{refusal.message}</p>
              ) : refusal.kind === "reconnect" ? (
                <Link
                  className="underline"
                  href={`/ads?${accountsParams.toString()}`}
                >
                  {tCampaigns("errors.notActive.action")}
                </Link>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <section
          aria-labelledby="new-campaign-basics"
          className="flex flex-col gap-6"
        >
          <h2 className="text-lg font-semibold" id="new-campaign-basics">
            {t("sections.basics")}
          </h2>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" maxLength={255} {...field} />
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
          {isGoogle ? (
            <AdsGoogleDateFields />
          ) : (
            <FormField
              control={form.control}
              name="objective"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("objective")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("objectivePlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {AD_CAMPAIGN_OBJECTIVES.map((candidate) => (
                        <SelectItem key={candidate} value={candidate}>
                          {t(`objectives.${candidate}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </section>

        {isGoogle ? (
          <AdsGoogleSearchFields marketKeywords={marketKeywords} />
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <Button asChild variant="ghost">
            <Link href={campaignsHref}>{tCampaigns("cancel")}</Link>
          </Button>
          <Button
            loading={form.formState.isSubmitting || created}
            type="submit"
          >
            {t("submit")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
