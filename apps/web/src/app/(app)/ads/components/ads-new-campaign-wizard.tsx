"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImageIcon,
  type LucideIcon,
  SearchIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useId, useRef, useState } from "react";
import {
  type FieldErrors,
  type FieldPath,
  useForm,
  useFormContext,
} from "react-hook-form";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  GOOGLE_DISPLAY_LIMITS,
  toGoogleDisplaySpec,
} from "@/lib/ads/google-display";
import { driveImagesOnly } from "@/lib/ads/google-display-images";
import {
  EMPTY_GOOGLE_VALUES,
  type GoogleFormValues,
} from "@/lib/ads/google-form-values";
import { parseGoogleKeywords } from "@/lib/ads/google-keywords";
import {
  GOOGLE_SEARCH_LIMITS,
  toGoogleSearchSpec,
} from "@/lib/ads/google-search";
import type { GoogleTarget } from "@/lib/ads/targeting";
import { cn } from "@/lib/utils";

import { AdsAdPreview } from "./ads-ad-preview";
import {
  type CampaignFormProps,
  type GoogleCampaignFormProps,
  NameAndBudgetFields,
  RefusalAlert,
  useBasics,
  useGoogleFormSchema,
  useSaveCampaign,
} from "./ads-campaign-form";
import { ImageUploadContext } from "./ads-display-images";
import { AdsGoogleDisplayFields } from "./ads-google-display-fields";
import {
  AdsGoogleDateFields,
  AdsKeywordsSection,
  AdsSearchAdSection,
} from "./ads-google-search-fields";
import { AdsSection } from "./ads-section";
import { AdsGoogleTargetingFields } from "./ads-targeting-fields";

const GOOGLE_TYPES = ["SEARCH", "DISPLAY"] as const;
type GoogleType = (typeof GOOGLE_TYPES)[number];

/** What each type's card shows: a search result, or an image on a page. */
const TYPE_ICONS: Record<GoogleType, LucideIcon> = {
  SEARCH: SearchIcon,
  DISPLAY: ImageIcon,
};

/** Fields that belong only to Search; their refusals go when switching to Display. */
const SEARCH_ONLY_FIELDS = [
  "keywords",
  "path1",
  "path2",
  "headlines",
  "descriptions",
  "sitelinks",
  "callouts",
] as const;

/** Fields that belong only to Display; their refusals go when switching to Search. */
const DISPLAY_ONLY_FIELDS = [
  "businessName",
  "displayHeadlines",
  "longHeadline",
  "displayDescriptions",
  "images",
] as const;

type GoogleStep =
  | "type"
  | "basics"
  | "targeting"
  | "keywords"
  | "ad"
  | "review";

/** The steps of each type: Display has no keywords. */
const GOOGLE_STEPS: Record<GoogleType, readonly GoogleStep[]> = {
  SEARCH: ["type", "basics", "targeting", "keywords", "ad", "review"],
  DISPLAY: ["type", "basics", "targeting", "ad", "review"],
};

/** What "Next" checks on each step before it moves on. */
function googleStepFields(
  step: GoogleStep,
  type: GoogleType,
): FieldPath<GoogleFormValues>[] {
  switch (step) {
    case "basics":
      return ["name", "dailyBudget", "startDate", "endDate"];
    case "targeting":
      return ["locations", "languages"];
    case "keywords":
      return ["keywords"];
    case "ad":
      return type === "SEARCH"
        ? ["finalUrl", ...SEARCH_ONLY_FIELDS.filter((f) => f !== "keywords")]
        : ["finalUrl", ...DISPLAY_ONLY_FIELDS];
    default:
      return [];
  }
}

/** The first step holding a refusal, to go back to after a refused create. */
function firstStepWithError<S extends string>(
  steps: readonly S[],
  fieldsOf: (step: S) => readonly string[],
  errors: FieldErrors,
): number {
  const index = steps.findIndex((step) =>
    fieldsOf(step).some((field) => field in errors),
  );
  return Math.max(index, 0);
}

interface WizardProps {
  /** "Google Ads account Sokosumi", under the title. */
  accountLabel: string;
  onClose: () => void;
  /** Saving: the dialog cannot be dismissed meanwhile. */
  onBusyChange: (busy: boolean) => void;
}

interface WizardFrameProps {
  accountLabel: string;
  children: ReactNode;
  /** The step's labels, in order. */
  labels: readonly string[];
  step: number;
  /** Go back to an earlier step. */
  onJump: (step: number) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  /** Pictures are still going in; the wizard waits for them. */
  uploading?: boolean;
}

/**
 * The wizard's frame inside the dialog, as the project wizard draws it: the
 * title and the steps (a bar each, earlier ones to click back to), the step,
 * and Back / Next (or Create on the last step) at the bottom. One `<form>`
 * spans it, so Enter moves on as Next does.
 */
function WizardFrame({
  accountLabel,
  children,
  labels,
  onCancel,
  onJump,
  onSubmit,
  step,
  submitting,
  uploading = false,
}: WizardFrameProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const last = step === labels.length - 1;
  const bodyRef = useRef<HTMLDivElement>(null);
  // Each step mounts anew (keyed): start it at the top and move focus there,
  // so the field that held focus on the last step is not lost with it.
  const showStep = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    node.focus({ preventScroll: true });
  }, []);

  return (
    <form
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-4 px-6 pt-5 pb-4 sm:px-8 sm:pt-6">
        <div className="flex flex-col gap-0.5 pr-8">
          <DialogTitle className="text-base font-semibold">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {accountLabel}
          </DialogDescription>
        </div>
        <ol aria-label={t("wizard.stepsLabel")} className="flex gap-1.5">
          {labels.map((label, index) => {
            const done = index < step;
            const content = (
              <>
                <span className="bg-border block h-[3px] overflow-hidden rounded-full">
                  <span
                    className={cn(
                      "bg-primary block size-full origin-left transition-transform duration-200 ease-out motion-reduce:transition-none",
                      index <= step ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "mt-2 hidden truncate text-xs sm:block",
                    index === step
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </>
            );
            return (
              <li
                key={label}
                aria-current={index === step ? "step" : undefined}
                className="min-w-0 flex-1"
              >
                {done ? (
                  <button
                    className="focus-visible:ring-ring-halo block w-full rounded-sm text-left outline-none focus-visible:ring-[3px] [&>span:last-child]:hover:text-foreground"
                    disabled={submitting}
                    onClick={() => onJump(index)}
                    type="button"
                  >
                    <span className="sr-only">
                      {t("wizard.backTo", { step: label })}
                    </span>
                    {content}
                  </button>
                ) : (
                  <div>
                    <span className="sr-only">{label}</span>
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <p className="text-muted-foreground text-xs sm:hidden">
          {t("wizard.stepOf", {
            current: step + 1,
            total: labels.length,
            step: labels[step],
          })}
        </p>
      </div>

      <div
        className="app-scrollbar min-h-0 overflow-y-auto border-t px-6 py-6 sm:px-10 sm:py-8"
        ref={bodyRef}
      >
        <div
          key={step}
          className="animate-in outline-none fade-in-0 slide-in-from-bottom-1 mx-auto flex w-full max-w-2xl flex-col gap-8 duration-200 ease-out motion-reduce:animate-none"
          ref={showStep}
          tabIndex={-1}
        >
          {children}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
        {step > 0 ? (
          <Button
            disabled={submitting}
            onClick={() => onJump(step - 1)}
            type="button"
            variant="ghost"
          >
            <ArrowLeft aria-hidden className="size-4" />
            {t("wizard.back")}
          </Button>
        ) : (
          <Button onClick={onCancel} type="button" variant="ghost">
            {tCampaigns("cancel")}
          </Button>
        )}
        {/* Always there, so the wait is announced when it starts. */}
        <span className="text-muted-foreground mr-auto text-sm" role="status">
          {uploading ? t("uploadingImages") : null}
        </span>
        <Button
          className="min-w-28"
          disabled={uploading}
          loading={last && submitting}
          type="submit"
        >
          {last ? (
            t("submit")
          ) : (
            <>
              {t("wizard.next")}
              <ArrowRight aria-hidden className="size-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

/**
 * Search or Display, as cards that say what each one needs, so the reader
 * knows what the next steps will ask for. Switching keeps what both share.
 */
function GoogleTypeStep() {
  const t = useTranslations("App.Ads.newCampaign");
  const form = useFormContext<GoogleFormValues>();
  const id = useId();
  const needs: Record<GoogleType, string[]> = {
    SEARCH: [
      t("needs.keywords"),
      t("needs.searchTexts", {
        minHeadlines: GOOGLE_SEARCH_LIMITS.headlines.min,
        maxHeadlines: GOOGLE_SEARCH_LIMITS.headlines.max,
        minDescriptions: GOOGLE_SEARCH_LIMITS.descriptions.min,
        maxDescriptions: GOOGLE_SEARCH_LIMITS.descriptions.max,
      }),
      t("needs.finalUrl"),
    ],
    DISPLAY: [
      t("needs.businessName"),
      t("needs.displayTexts", {
        maxHeadlines: GOOGLE_DISPLAY_LIMITS.headlines.max,
        maxDescriptions: GOOGLE_DISPLAY_LIMITS.descriptions.max,
      }),
      t("needs.images"),
      t("needs.finalUrl"),
    ],
  };

  return (
    <AdsSection id="campaign-wizard-type" title={t("typeTitle")}>
      <p className="text-muted-foreground -mt-3 text-sm">{t("typeIntro")}</p>
      <RadioGroup
        aria-labelledby="campaign-wizard-type"
        className="grid gap-4 sm:grid-cols-2"
        onValueChange={(value) => {
          const type = GOOGLE_TYPES.find((candidate) => candidate === value);
          if (!type) return;
          form.setValue("type", type);
          // Spec: clear the other type's refusals; keep shared Basics.
          form.clearErrors(
            type === "DISPLAY" ? SEARCH_ONLY_FIELDS : DISPLAY_ONLY_FIELDS,
          );
        }}
        value={form.watch("type")}
      >
        {GOOGLE_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type];
          return (
            // A plan card from Billing, chosen like a radio: the chosen one
            // takes the accent border and its icon the accent.
            <label
              key={type}
              className="group bg-card has-[[data-state=checked]]:border-primary has-[:focus-visible]:ring-ring-halo hover:bg-card-background-hover flex cursor-pointer flex-col gap-5 rounded-xl border p-5 transition-colors has-[:focus-visible]:ring-[3px]"
              htmlFor={`${id}-${type}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  aria-hidden
                  className="bg-quinary text-muted-foreground group-has-[[data-state=checked]]:text-primary flex size-10 items-center justify-center rounded-lg transition-colors"
                >
                  <Icon className="size-5" />
                </span>
                <RadioGroupItem
                  aria-describedby={`${id}-${type}-help`}
                  aria-labelledby={`${id}-${type}-name`}
                  id={`${id}-${type}`}
                  value={type}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span
                  className="text-base font-semibold"
                  id={`${id}-${type}-name`}
                >
                  {t(`types.${type}`)}
                </span>
                <span
                  className="text-muted-foreground text-sm text-pretty"
                  id={`${id}-${type}-help`}
                >
                  {t(`typeHelp.${type}`)}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs font-semibold">
                  {t("needs.title")}
                </span>
                <ul className="flex flex-col gap-2 text-sm">
                  {needs[type].map((need) => (
                    <li key={need} className="flex gap-2 text-pretty">
                      <Check
                        aria-hidden
                        className="text-primary mt-0.5 size-4 shrink-0"
                      />
                      {need}
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          );
        })}
      </RadioGroup>
    </AdsSection>
  );
}

/** One line of the review: what it is, what was chosen, and a way back to it. */
function SummaryRow({
  label,
  children,
  onEdit,
}: {
  label: string;
  children: ReactNode;
  onEdit?: () => void;
}) {
  const t = useTranslations("App.Ads.newCampaign.review");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="col-start-1 row-start-2 min-w-0 text-sm break-words sm:col-start-2 sm:row-start-1">
        {children}
      </dd>
      {onEdit ? (
        <Button
          aria-label={t("editLabel", { section: label })}
          className="text-muted-foreground hover:text-foreground row-span-2 h-auto px-2 py-1 sm:row-span-1"
          onClick={onEdit}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("edit")}
        </Button>
      ) : null}
    </div>
  );
}

function targetNames(targets: readonly GoogleTarget[], all: string): string {
  return targets.length > 0 ? targets.map(({ name }) => name).join(", ") : all;
}

/** A start and an end date as the review says them. */
function useScheduleText() {
  const t = useTranslations("App.Ads.newCampaign.review");
  const formatter = useFormatter();
  const day = (value: string) =>
    formatter.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });

  return (startDate: string, endDate: string) => {
    if (startDate && endDate) {
      return t("schedule.range", { start: day(startDate), end: day(endDate) });
    }
    if (startDate) return t("schedule.from", { start: day(startDate) });
    if (endDate) return t("schedule.until", { end: day(endDate) });
    return t("schedule.none");
  };
}

function useMoney(currency: string) {
  const formatter = useFormatter();
  return (value: string) =>
    formatter.number(Number(value), { style: "currency", currency });
}

/** The last step: the ad as it could look, then what will be created. */
function GoogleReviewStep({
  currency,
  goTo,
  refusal,
}: {
  currency: string;
  goTo: (step: GoogleStep) => void;
  refusal: ReactNode;
}) {
  const t = useTranslations("App.Ads.newCampaign");
  const form = useFormContext<GoogleFormValues>();
  const values = form.watch();
  const money = useMoney(currency);
  const schedule = useScheduleText();
  const search = values.type === "SEARCH";

  return (
    <>
      {refusal}
      <AdsSection id="campaign-wizard-preview" title={t("preview.title")}>
        <AdsAdPreview />
      </AdsSection>
      <AdsSection id="campaign-wizard-summary" title={t("review.title")}>
        <dl className="flex flex-col gap-3">
          <SummaryRow label={t("sections.type")} onEdit={() => goTo("type")}>
            {t(`types.${values.type}`)}
          </SummaryRow>
          <SummaryRow label={t("name")} onEdit={() => goTo("basics")}>
            {values.name.trim()}
          </SummaryRow>
          <SummaryRow
            label={t("review.dailyBudget")}
            onEdit={() => goTo("basics")}
          >
            {money(values.dailyBudget)}
          </SummaryRow>
          <SummaryRow
            label={t("review.schedule.label")}
            onEdit={() => goTo("basics")}
          >
            {schedule(values.startDate, values.endDate)}
          </SummaryRow>
          <SummaryRow
            label={t("targeting.locations.label")}
            onEdit={() => goTo("targeting")}
          >
            {targetNames(values.locations, t("targeting.locations.all"))}
          </SummaryRow>
          <SummaryRow
            label={t("targeting.languages.label")}
            onEdit={() => goTo("targeting")}
          >
            {targetNames(values.languages, t("targeting.languages.all"))}
          </SummaryRow>
          {search ? (
            <SummaryRow
              label={t("keywords.label")}
              onEdit={() => goTo("keywords")}
            >
              {t("keywords.count", {
                count: parseGoogleKeywords(values.keywords).keywords.length,
              })}
            </SummaryRow>
          ) : null}
          <SummaryRow label={t("ad.finalUrl")} onEdit={() => goTo("ad")}>
            {values.finalUrl.trim()}
          </SummaryRow>
        </dl>
        <p className="text-muted-foreground text-sm">{t("note.google_ads")}</p>
      </AdsSection>
    </>
  );
}

interface NewGoogleCampaignWizardProps
  extends GoogleCampaignFormProps,
    WizardProps {}

/**
 * Makes a Google campaign one step at a time, starting from the Market
 * profile's suggestions: the type, then what that type needs, then a review
 * with a preview of the ad and the button that creates it (paused).
 */
export function NewGoogleCampaignWizard({
  accountLabel,
  hasMarketProfile,
  onBusyChange,
  onClose,
  targeting,
  ...props
}: NewGoogleCampaignWizardProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const { accountId, projectId } = props;
  const { budget, schema } = useGoogleFormSchema(props.currency);
  const form = useForm({
    resolver: zodResolver(schema),
    mode: "onTouched",
    // The reader may remove the suggestions.
    defaultValues: {
      ...EMPTY_GOOGLE_VALUES,
      locations: targeting.defaultLocations,
      languages: targeting.defaultLanguages,
    },
  });
  const saving = useSaveCampaign({
    success: { message: t("success"), onSaved: onClose },
  });
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState(0);
  const type = form.watch("type");
  const steps = GOOGLE_STEPS[type];
  const current = steps[step];
  const fieldsOf = (candidate: GoogleStep) => googleStepFields(candidate, type);

  async function next(): Promise<void> {
    if (await form.trigger(fieldsOf(current), { shouldFocus: true })) {
      setStep(step + 1);
    }
  }

  const create = form.handleSubmit(
    async (values) => {
      onBusyChange(true);
      try {
        await saving.save(() =>
          createAdCampaign({
            projectId,
            accountId,
            name: values.name.trim(),
            dailyBudget: Number(values.dailyBudget),
            google:
              values.type === "SEARCH"
                ? toGoogleSearchSpec(values)
                : toGoogleDisplaySpec({
                    ...values,
                    images: driveImagesOnly(values.images),
                  }),
          }),
        );
      } finally {
        onBusyChange(false);
      }
    },
    (errors) => setStep(firstStepWithError(steps, fieldsOf, errors)),
  );

  const content: Record<GoogleStep, ReactNode> = {
    type: <GoogleTypeStep />,
    basics: (
      <AdsSection id="campaign-form-basics" title={t("sections.basics")}>
        <NameAndBudgetFields budget={budget} />
        <AdsGoogleDateFields />
      </AdsSection>
    ),
    targeting: (
      <AdsSection id="campaign-form-targeting" title={t("sections.targeting")}>
        <AdsGoogleTargetingFields
          accountId={accountId}
          languageOptions={targeting.languageOptions}
          projectId={projectId}
        />
      </AdsSection>
    ),
    keywords: (
      <AdsKeywordsSection
        hasMarketProfile={hasMarketProfile}
        projectId={projectId}
      />
    ),
    ad: type === "SEARCH" ? <AdsSearchAdSection /> : <AdsGoogleDisplayFields />,
    review: (
      <GoogleReviewStep
        currency={props.currency}
        goTo={(target) => setStep(steps.indexOf(target))}
        refusal={
          saving.refusal ? (
            // A new key per attempt re-mounts the alert, which focuses it again.
            <RefusalAlert
              failedTitle={t("errors.failed")}
              key={saving.refusal.attempt}
              projectId={projectId}
              refusal={saving.refusal}
            />
          ) : null
        }
      />
    ),
  };

  return (
    <Form {...form}>
      <ImageUploadContext value={{ uploading, setUploading }}>
        <WizardFrame
          accountLabel={accountLabel}
          labels={steps.map((candidate) => t(`steps.${candidate}`))}
          onCancel={onClose}
          onJump={setStep}
          onSubmit={() => void (current === "review" ? create() : next())}
          step={step}
          submitting={form.formState.isSubmitting || saving.saved}
          uploading={uploading}
        >
          {content[current]}
        </WizardFrame>
      </ImageUploadContext>
    </Form>
  );
}

type MetaStep = "basics" | "review";
const META_STEPS: readonly MetaStep[] = ["basics", "review"];
const META_STEP_FIELDS: Record<MetaStep, FieldPath<MetaValues>[]> = {
  basics: ["name", "dailyBudget", "objective"],
  review: [],
};

interface MetaValues {
  name: string;
  dailyBudget: string;
  objective: string;
}

interface NewMetaCampaignWizardProps extends CampaignFormProps, WizardProps {}

/**
 * Makes a Meta campaign: a name, a budget and one objective, then a review.
 * Its ad sets and ads are made in Meta Ads Manager, so there is no preview.
 */
export function NewMetaCampaignWizard({
  accountLabel,
  onBusyChange,
  onClose,
  ...props
}: NewMetaCampaignWizardProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const { budget, shape } = useBasics(props.currency);
  const form = useForm<MetaValues>({
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
    success: { message: t("success"), onSaved: onClose },
    budgetPrecisionOn422: true,
  });
  const [step, setStep] = useState(0);
  const current = META_STEPS[step];
  const money = useMoney(props.currency);
  const values = form.watch();
  const objective = AD_CAMPAIGN_OBJECTIVES.find(
    (candidate) => candidate === values.objective,
  );

  async function next(): Promise<void> {
    if (await form.trigger(META_STEP_FIELDS[current], { shouldFocus: true })) {
      setStep(step + 1);
    }
  }

  const create = form.handleSubmit(
    async ({ name, dailyBudget, objective }) => {
      onBusyChange(true);
      try {
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
          form.setError("dailyBudget", { message: budget.precisionMessage });
          setStep(0);
        }
      } finally {
        onBusyChange(false);
      }
    },
    () => setStep(0),
  );

  return (
    <Form {...form}>
      <WizardFrame
        accountLabel={accountLabel}
        labels={META_STEPS.map((candidate) => t(`steps.${candidate}`))}
        onCancel={onClose}
        onJump={setStep}
        onSubmit={() => void (current === "review" ? create() : next())}
        step={step}
        submitting={form.formState.isSubmitting || saving.saved}
      >
        {current === "basics" ? (
          <AdsSection id="campaign-form-basics" title={t("sections.basics")}>
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
        ) : (
          <>
            {saving.refusal ? (
              <RefusalAlert
                failedTitle={t("errors.failed")}
                key={saving.refusal.attempt}
                projectId={props.projectId}
                refusal={saving.refusal}
              />
            ) : null}
            <AdsSection id="campaign-wizard-summary" title={t("review.title")}>
              <dl className="flex flex-col gap-3">
                <SummaryRow label={t("name")} onEdit={() => setStep(0)}>
                  {values.name.trim()}
                </SummaryRow>
                <SummaryRow
                  label={t("review.dailyBudget")}
                  onEdit={() => setStep(0)}
                >
                  {money(values.dailyBudget)}
                </SummaryRow>
                <SummaryRow label={t("objective")} onEdit={() => setStep(0)}>
                  {objective ? t(`objectives.${objective}`) : null}
                </SummaryRow>
              </dl>
              <p className="text-muted-foreground text-sm">
                {t("note.meta_ads")}
              </p>
            </AdsSection>
          </>
        )}
      </WizardFrame>
    </Form>
  );
}
