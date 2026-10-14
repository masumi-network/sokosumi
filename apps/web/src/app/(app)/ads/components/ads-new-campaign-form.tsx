"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { useForm, useFormContext } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { campaignsHref } from "@/app/ads/ads-query";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { ActionResultDto } from "@/lib/actions/action-result";
import { createAdCampaign, editAdCampaign } from "@/lib/actions/ads/action";
import type { ActionError } from "@/lib/actions/errors/action-error";
import {
  AD_CAMPAIGN_NAME_MAX_LENGTH,
  AD_CAMPAIGN_OBJECTIVES,
} from "@/lib/ads/campaign";
import {
  GOOGLE_DISPLAY_LIMITS,
  googleDisplayFormSchema,
  toGoogleDisplayEditSpec,
  toGoogleDisplaySpec,
} from "@/lib/ads/google-display";
import {
  EMPTY_GOOGLE_VALUES,
  type GoogleFormValues,
} from "@/lib/ads/google-form-values";
import {
  GOOGLE_KEYWORD_LIMIT,
  GOOGLE_KEYWORD_MAX_LENGTH,
  GOOGLE_KEYWORD_MAX_WORDS,
} from "@/lib/ads/google-keywords";
import {
  GOOGLE_SEARCH_LIMITS,
  googleSearchFormSchema,
  toGoogleSearchSpec,
} from "@/lib/ads/google-search";
import type { GoogleTargeting } from "@/lib/ads/targeting";
import { useAdsBudget } from "./ads-budget";
import { ImageUploadContext } from "./ads-display-images";
import { AdsGoogleDisplayFields } from "./ads-google-display-fields";
import {
  AdsGoogleDateFields,
  AdsGoogleSearchFields,
} from "./ads-google-search-fields";
import { AdsSection } from "./ads-section";
import { AdsGoogleTargetingFields } from "./ads-targeting-fields";

interface CampaignFormProps {
  accountId: string;
  currency: string;
  projectId: string;
}

interface GoogleCampaignFormProps extends CampaignFormProps {
  /** Present when an existing campaign is edited instead of a new one made. */
  edit?: {
    campaignId: string;
    /** Where the details page of the campaign is, to go back to. */
    detailsHref: string;
    /** Its start date can no longer change. */
    started: boolean;
    initialValues: GoogleFormValues;
  };
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

interface SaveCampaignOptions {
  projectId: string;
  /** Where a saved campaign leads, and what the toast says. */
  successHref: string;
  successMessage: string;
  /** Meta create maps 422 to the budget field (our precision copy). */
  budgetPrecisionOn422?: boolean;
  /** Said for a 409 instead of asking to reconnect (an edit has another cause). */
  conflictMessage?: string;
  /** Takes the form back to its start after a save, once Next shows it again. */
  onStartOver: () => void;
}

/**
 * Sends the campaign and follows the outcome. Core answers the create and the
 * edit alike, and the action revalidates the pages, so nothing updates
 * optimistically.
 *
 * Google keeps Core's/Google's message for a 422 in the alert.
 */
function useSaveCampaign({
  projectId,
  successHref,
  successMessage,
  budgetPrecisionOn422 = false,
  conflictMessage,
  onStartOver,
}: SaveCampaignOptions) {
  const router = useRouter();
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
    onStartOver();
  });

  async function save(
    send: () => Promise<ActionResultDto<unknown, ActionError>>,
  ): Promise<SaveOutcome> {
    setRefusal(null);
    const attempt = (refusal?.attempt ?? 0) + 1;
    try {
      const result = await send();
      if (result.ok) {
        toast.success(successMessage);
        savedRef.current = true;
        setSaved(true);
        router.push(successHref);
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
      if (result.error.status === 409 && conflictMessage) {
        setRefusal({ attempt, kind: "refused", message: conflictMessage });
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
function RefusalAlert({
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

interface CampaignFormFrameProps {
  cancelHref: string;
  children: ReactNode;
  failedTitle: string;
  /** A note above the actions. */
  note?: string;
  projectId: string;
  saving: ReturnType<typeof useSaveCampaign>;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  submitting: boolean;
  /** Pictures are still going in; the campaign waits for them. */
  uploading?: boolean;
}

/** The form element around a provider's fields: the failure above, actions below. */
function CampaignFormFrame({
  cancelHref,
  children,
  failedTitle,
  note,
  onSubmit,
  projectId,
  saving,
  submitLabel,
  submitting,
  uploading = false,
}: CampaignFormFrameProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");

  return (
    <form
      className="flex flex-col gap-10"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {saving.refusal ? (
        // A new key per attempt re-mounts the alert, which focuses it again.
        <RefusalAlert
          failedTitle={failedTitle}
          key={saving.refusal.attempt}
          projectId={projectId}
          refusal={saving.refusal}
        />
      ) : null}
      {children}
      <div className="flex flex-col gap-3">
        {note ? (
          <p className="text-muted-foreground text-right text-sm">{note}</p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          {/* Always there, so the wait is announced when it starts. */}
          <span className="text-muted-foreground mr-auto text-sm" role="status">
            {uploading ? t("uploadingImages") : null}
          </span>
          <Button asChild variant="ghost">
            <Link href={cancelHref}>{tCampaigns("cancel")}</Link>
          </Button>
          <Button
            disabled={uploading}
            loading={submitting || saving.saved}
            type="submit"
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The name and daily budget, which every campaign has. */
function useBasics(currency: string) {
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

function NameAndBudgetFields({
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

/** A Meta campaign: a name, a budget and one objective. */
export function MetaCampaignForm(props: CampaignFormProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const { budget, shape } = useBasics(props.currency);
  const form = useForm({
    resolver: zodResolver(
      z.object({
        ...shape,
        objective: z.string().min(1, t("errors.objectiveRequired")),
      }),
    ),
    mode: "onTouched",
    defaultValues: { name: "", dailyBudget: "", objective: "" },
  });
  const saving = useSaveCampaign({
    projectId: props.projectId,
    successHref: campaignsHref(props.projectId, props.accountId),
    successMessage: t("success"),
    budgetPrecisionOn422: true,
    onStartOver: () => form.reset(),
  });

  return (
    <Form {...form}>
      <CampaignFormFrame
        cancelHref={campaignsHref(props.projectId, props.accountId)}
        failedTitle={t("errors.failed")}
        projectId={props.projectId}
        saving={saving}
        submitLabel={t("submit")}
        onSubmit={form.handleSubmit(
          async ({ name, dailyBudget, objective }) => {
            const outcome = await saving.save(() =>
              createAdCampaign({
                projectId: props.projectId,
                accountId: props.accountId,
                name,
                dailyBudget: Number(dailyBudget),
                objective: AD_CAMPAIGN_OBJECTIVES.find(
                  (candidate) => candidate === objective,
                ),
              }),
            );
            if (outcome === "budget_refused") {
              form.setError("dailyBudget", {
                message: budget.precisionMessage,
              });
            }
          },
        )}
        submitting={form.formState.isSubmitting}
      >
        <AdsSection id="new-campaign-basics" title={t("sections.basics")}>
          <NameAndBudgetFields budget={budget} />
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
        </AdsSection>
      </CampaignFormFrame>
    </Form>
  );
}

const GOOGLE_TYPES = ["SEARCH", "DISPLAY"] as const;

/** Fields that belong only to Search; cleared when switching to Display. */
const SEARCH_ONLY_FIELDS = [
  "keywords",
  "path1",
  "path2",
  "headlines",
  "descriptions",
  "sitelinks",
  "callouts",
] as const;

/** Fields that belong only to Display; cleared when switching to Search. */
const DISPLAY_ONLY_FIELDS = [
  "businessName",
  "displayHeadlines",
  "longHeadline",
  "displayDescriptions",
  "images",
] as const;

/**
 * Search or Display. Switching keeps what both share and swaps the rest. A
 * campaign being edited keeps its type: it is only told.
 */
function GoogleTypePicker({ locked }: { locked: boolean }) {
  const t = useTranslations("App.Ads.newCampaign");
  const form = useFormContext<GoogleFormValues>();

  if (locked) {
    const type = form.getValues("type");
    return (
      <AdsSection id="new-campaign-type" title={t("sections.type")}>
        <div className="grid gap-1">
          <p className="text-sm font-medium">{t(`types.${type}`)}</p>
          <p className="text-muted-foreground text-sm">
            {t(`typeHelp.${type}`)}
          </p>
        </div>
      </AdsSection>
    );
  }

  return (
    <AdsSection id="new-campaign-type" title={t("sections.type")}>
      <div className="grid gap-2">
        <ToggleGroup
          aria-label={t("sections.type")}
          className="w-full sm:w-72"
          onValueChange={(value) => {
            // Clicking the chosen type again would clear it; keep it.
            const type = GOOGLE_TYPES.find((candidate) => candidate === value);
            if (type) {
              form.setValue("type", type);
              // Spec: clear the other type's refusals; keep shared Basics.
              form.clearErrors(
                type === "DISPLAY" ? SEARCH_ONLY_FIELDS : DISPLAY_ONLY_FIELDS,
              );
            }
          }}
          type="single"
          value={form.watch("type")}
          variant="outline"
        >
          {GOOGLE_TYPES.map((type) => (
            <ToggleGroupItem key={type} value={type}>
              {t(`types.${type}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-muted-foreground text-sm">
          {t(`typeHelp.${form.watch("type")}`)}
        </p>
      </div>
    </AdsSection>
  );
}

/**
 * A Google campaign, Search or Display: the type is picked at the top, and the
 * name, budget, dates, targeting and final URL stay when it changes. Core's
 * rules per type are the Search keywords and responsive search ad, or the
 * Display images and responsive display ad.
 */
export function GoogleCampaignForm({
  edit,
  hasMarketProfile,
  targeting,
  ...props
}: GoogleCampaignFormProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const tEdit = useTranslations("App.Ads.editCampaign");
  const { budget, shape } = useBasics(props.currency);
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
  const form = useForm({
    resolver: zodResolver(schema),
    mode: "onTouched",
    // An edit starts from the campaign; a new one from the Market profile's
    // suggestions, which the reader may remove.
    defaultValues: edit?.initialValues ?? {
      ...EMPTY_GOOGLE_VALUES,
      locations: targeting.defaultLocations,
      languages: targeting.defaultLanguages,
    },
  });
  const saving = useSaveCampaign({
    projectId: props.projectId,
    successHref:
      edit?.detailsHref ?? campaignsHref(props.projectId, props.accountId),
    successMessage: edit ? tEdit("success") : t("success"),
    conflictMessage: edit ? tEdit("errors.conflict") : undefined,
    onStartOver: () => form.reset(),
  });
  const [uploading, setUploading] = useState(false);
  const type = form.watch("type");

  return (
    <Form {...form}>
      <ImageUploadContext value={{ uploading, setUploading }}>
        <CampaignFormFrame
          cancelHref={
            edit?.detailsHref ?? campaignsHref(props.projectId, props.accountId)
          }
          failedTitle={edit ? tEdit("errors.failed") : t("errors.failed")}
          note={edit ? tEdit("reviewNote") : undefined}
          projectId={props.projectId}
          saving={saving}
          submitLabel={edit ? tEdit("submit") : t("submit")}
          onSubmit={form.handleSubmit(async (values) => {
            const name = values.name.trim();
            const dailyBudget = Number(values.dailyBudget);
            const base = {
              projectId: props.projectId,
              accountId: props.accountId,
              name,
              dailyBudget,
            };
            if (edit) {
              // A started campaign keeps its start date: leave it out, and
              // Core keeps it.
              const sent = edit.started ? { ...values, startDate: "" } : values;
              await saving.save(() =>
                editAdCampaign({
                  ...base,
                  campaignId: edit.campaignId,
                  google:
                    sent.type === "SEARCH"
                      ? toGoogleSearchSpec(sent)
                      : toGoogleDisplayEditSpec(sent),
                }),
              );
              return;
            }
            await saving.save(() =>
              createAdCampaign({
                ...base,
                google:
                  values.type === "SEARCH"
                    ? toGoogleSearchSpec(values)
                    : toGoogleDisplaySpec(values),
              }),
            );
          })}
          submitting={form.formState.isSubmitting}
          uploading={uploading}
        >
          <GoogleTypePicker locked={!!edit} />
          <AdsSection id="new-campaign-basics" title={t("sections.basics")}>
            <NameAndBudgetFields budget={budget} />
            <AdsGoogleDateFields startDateLocked={edit?.started ?? false} />
          </AdsSection>
          <AdsSection
            id="new-campaign-targeting"
            title={t("sections.targeting")}
          >
            <AdsGoogleTargetingFields
              accountId={props.accountId}
              languageOptions={targeting.languageOptions}
              projectId={props.projectId}
            />
          </AdsSection>
          {type === "SEARCH" ? (
            <AdsGoogleSearchFields
              hasMarketProfile={hasMarketProfile}
              projectId={props.projectId}
            />
          ) : (
            <AdsGoogleDisplayFields />
          )}
        </CampaignFormFrame>
      </ImageUploadContext>
    </Form>
  );
}
