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
import { TaskFormModalHeaderStart } from "@/app/tasks/components/task-form-modal";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionResultDto } from "@/lib/actions/action-result";
import { createAdCampaign, editAdCampaign } from "@/lib/actions/ads/action";
import type { ActionError } from "@/lib/actions/errors/action-error";
import {
  AD_CAMPAIGN_OBJECTIVES,
  CORE_CAMPAIGN_NOT_EDITABLE,
} from "@/lib/ads/campaign";
import {
  GOOGLE_DISPLAY_LIMITS,
  toGoogleDisplayEditSpec,
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
  toGoogleSearchEditSpec,
  toGoogleSearchSpec,
} from "@/lib/ads/google-search";
import type { GoogleTarget } from "@/lib/ads/targeting";
import { cn } from "@/lib/utils";

import { AdsAdPreview } from "./ads-ad-preview";
import {
  type CampaignFormProps,
  type GoogleCampaignFormProps,
  type GoogleFormOutput,
  NameAndBudgetFields,
  RefusalAlert,
  type SaveCampaignOptions,
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

const TYPE_ICONS: Record<GoogleType, LucideIcon> = {
  SEARCH: SearchIcon,
  DISPLAY: ImageIcon,
};

const SEARCH_ONLY_FIELDS = [
  "keywords",
  "path1",
  "path2",
  "headlines",
  "descriptions",
  "sitelinks",
  "callouts",
] as const;

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

const GOOGLE_STEPS: Record<GoogleType, readonly GoogleStep[]> = {
  SEARCH: ["type", "basics", "targeting", "keywords", "ad", "review"],
  DISPLAY: ["type", "basics", "targeting", "ad", "review"],
};

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
  accountLabel: string;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}

interface WizardFrameProps {
  accountLabel: string;
  children: ReactNode;
  labels: readonly string[];
  step: number;
  onJump: (step: number) => void;
  onSubmit: () => void;
  submitting: boolean;
  uploading?: boolean;
  wide?: boolean;
  /** What the last step's button says. */
  submitLabel: string;
  /**
   * Every step can be opened from the bar, not only earlier ones: a campaign
   * being edited is complete, so the reader goes straight to what changes.
   */
  openSteps?: boolean;
}

function WizardFrame({
  accountLabel,
  children,
  labels,
  onJump,
  onSubmit,
  step,
  submitting,
  uploading = false,
  wide = false,
  submitLabel,
  openSteps = false,
}: WizardFrameProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const last = step === labels.length - 1;
  const bodyRef = useRef<HTMLDivElement>(null);
  const showStep = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    node.focus({ preventScroll: true });
  }, []);

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {step > 0 ? (
        <TaskFormModalHeaderStart key={`${step}:${submitting}`}>
          <Button
            className="text-primary -ml-2"
            disabled={submitting}
            onClick={() => onJump(step - 1)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ArrowLeft aria-hidden className="mr-1 size-3.5" />
            {t("wizard.back")}
          </Button>
        </TaskFormModalHeaderStart>
      ) : null}

      <div className="shrink-0 px-6 py-4 md:px-8">
        <ol aria-label={t("wizard.stepsLabel")} className="flex gap-1.5">
          {labels.map((label, index) => {
            const reachable = openSteps ? index !== step : index < step;
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
                {reachable ? (
                  <button
                    className="focus-visible:ring-ring-halo block w-full rounded-sm text-left outline-none focus-visible:ring-[3px] [&>span:last-child]:hover:text-foreground"
                    disabled={submitting}
                    onClick={() => onJump(index)}
                    type="button"
                  >
                    <span className="sr-only">
                      {t(openSteps ? "wizard.goTo" : "wizard.backTo", {
                        step: label,
                      })}
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
        <p className="text-muted-foreground mt-2 text-xs sm:hidden">
          {t("wizard.stepOf", {
            current: step + 1,
            total: labels.length,
            step: labels[step],
          })}
        </p>
      </div>

      <div
        className="app-scrollbar min-h-0 flex-1 overflow-y-auto border-t px-6 py-6 md:px-8 md:py-8"
        ref={bodyRef}
      >
        <div
          key={step}
          className={cn(
            "animate-in fade-in-0 slide-in-from-bottom-1 mx-auto flex w-full flex-col gap-8 outline-none duration-200 ease-out motion-reduce:animate-none",
            wide ? "max-w-5xl" : "max-w-2xl",
          )}
          ref={showStep}
          tabIndex={-1}
        >
          {children}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-stretch justify-between gap-3 border-t px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center md:px-8">
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground truncate text-sm">
            {accountLabel}
          </span>
          {/* Always there, so the wait is announced when it starts. */}
          <span className="text-muted-foreground text-sm" role="status">
            {uploading ? t("uploadingImages") : null}
          </span>
        </div>
        <Button
          className="min-w-28 sm:ml-auto"
          disabled={uploading}
          loading={last && submitting}
          type="submit"
        >
          {last ? (
            submitLabel
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
          form.clearErrors(
            type === "DISPLAY" ? SEARCH_ONLY_FIELDS : DISPLAY_ONLY_FIELDS,
          );
        }}
        value={form.watch("type")}
      >
        {GOOGLE_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type];
          return (
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

/** The last step: the ad as it could look, then what will be saved. */
function GoogleReviewStep({
  currency,
  goTo,
  note,
  refusal,
  typeLocked,
}: {
  currency: string;
  goTo: (step: GoogleStep) => void;
  /** Said under the summary: how the campaign is created, or what an edit does. */
  note: string;
  refusal: ReactNode;
  /** An edit keeps its type, so its row has nothing to edit. */
  typeLocked: boolean;
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
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <AdsSection id="campaign-wizard-preview" title={t("preview.title")}>
          <AdsAdPreview />
        </AdsSection>
        <AdsSection id="campaign-wizard-summary" title={t("review.title")}>
          <dl className="flex flex-col gap-3">
            <SummaryRow
              label={t("sections.type")}
              onEdit={typeLocked ? undefined : () => goTo("type")}
            >
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
          <p className="text-muted-foreground text-sm">{note}</p>
        </AdsSection>
      </div>
    </>
  );
}

interface GoogleWizardSetup {
  defaultValues: GoogleFormValues;
  /** An edit keeps its type (no type step) and opens every step from the bar. */
  editing: boolean;
  startDateHint?: string;
  failedTitle: string;
  submitLabel: string;
  note: string;
  save: Pick<SaveCampaignOptions, "success" | "explain">;
  send: (
    values: GoogleFormOutput,
  ) => Promise<ActionResultDto<unknown, ActionError>>;
}

interface GoogleCampaignWizardProps
  extends GoogleCampaignFormProps,
    WizardProps {}

/**
 * A Google campaign one step at a time: what the type needs, then a review
 * with a preview of the ad and the button that saves it. The type is picked
 * first for a new campaign; an edit keeps it.
 */
function GoogleCampaignWizard({
  accountLabel,
  hasMarketProfile,
  onBusyChange,
  setup,
  targeting,
  ...props
}: GoogleCampaignWizardProps & { setup: GoogleWizardSetup }) {
  const t = useTranslations("App.Ads.newCampaign");
  const { accountId, projectId } = props;
  const { budget, schema } = useGoogleFormSchema(props.currency);
  const form = useForm({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: setup.defaultValues,
  });
  const saving = useSaveCampaign(setup.save);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState(0);
  const type = form.watch("type");
  const steps = setup.editing
    ? GOOGLE_STEPS[type].filter((candidate) => candidate !== "type")
    : GOOGLE_STEPS[type];
  const current = steps[step];
  const fieldsOf = (candidate: GoogleStep) => googleStepFields(candidate, type);

  async function handleNext(): Promise<void> {
    if (await form.trigger(fieldsOf(current), { shouldFocus: true })) {
      setStep(step + 1);
    }
  }

  const handleSave = form.handleSubmit(
    async (values) => {
      onBusyChange(true);
      try {
        await saving.save(() => setup.send(values));
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
        <AdsGoogleDateFields startDateHint={setup.startDateHint} />
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
        note={setup.note}
        refusal={
          saving.refusal ? (
            <RefusalAlert
              failedTitle={setup.failedTitle}
              key={saving.refusal.attempt}
              projectId={projectId}
              refusal={saving.refusal}
            />
          ) : null
        }
        typeLocked={setup.editing}
      />
    ),
  };

  return (
    <Form {...form}>
      <ImageUploadContext value={{ uploading, setUploading }}>
        <WizardFrame
          accountLabel={accountLabel}
          labels={steps.map((candidate) => t(`steps.${candidate}`))}
          onJump={setStep}
          onSubmit={() =>
            void (current === "review" ? handleSave() : handleNext())
          }
          openSteps={setup.editing}
          step={step}
          submitLabel={setup.submitLabel}
          submitting={form.formState.isSubmitting || saving.saved}
          uploading={uploading}
          wide={current === "review"}
        >
          {content[current]}
        </WizardFrame>
      </ImageUploadContext>
    </Form>
  );
}

/**
 * Makes a Google campaign, starting from the Market profile's suggestions:
 * the type, then what that type needs, then the review that creates it
 * (paused).
 */
export function NewGoogleCampaignWizard({
  targeting,
  ...props
}: GoogleCampaignWizardProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const { accountId, projectId } = props;

  return (
    <GoogleCampaignWizard
      {...props}
      setup={{
        defaultValues: {
          ...EMPTY_GOOGLE_VALUES,
          locations: targeting.defaultLocations,
          languages: targeting.defaultLanguages,
        },
        editing: false,
        failedTitle: t("errors.failed"),
        submitLabel: t("submit"),
        note: t("note.google_ads"),
        save: { success: { message: t("success"), onSaved: props.onClose } },
        send: (values) =>
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
      }}
      targeting={targeting}
    />
  );
}

interface EditGoogleCampaignWizardProps extends GoogleCampaignWizardProps {
  campaignId: string;
  /** Its start date can no longer change. */
  started: boolean;
  /** The campaign as it is now. */
  initialValues: GoogleFormValues;
}

/** Edits a Google campaign, starting from what it is now. */
export function EditGoogleCampaignWizard({
  campaignId,
  initialValues,
  started,
  ...props
}: EditGoogleCampaignWizardProps) {
  const t = useTranslations("App.Ads.editCampaign");
  const { accountId, projectId } = props;

  return (
    <GoogleCampaignWizard
      {...props}
      setup={{
        defaultValues: initialValues,
        editing: true,
        startDateHint: started ? t("startDateLocked") : undefined,
        failedTitle: t("errors.failed"),
        submitLabel: t("submit"),
        note: t("reviewNote"),
        save: {
          success: { message: t("success"), onSaved: props.onClose },
          // Core's 409 is also an inactive connection, which asks to reconnect.
          explain: ({ message, status }) =>
            status === 409 && message === CORE_CAMPAIGN_NOT_EDITABLE
              ? t("errors.conflict")
              : undefined,
        },
        send: (values) =>
          editAdCampaign({
            projectId,
            accountId,
            campaignId,
            name: values.name.trim(),
            dailyBudget: Number(values.dailyBudget),
            google:
              values.type === "SEARCH"
                ? toGoogleSearchEditSpec(values, { started })
                : toGoogleDisplayEditSpec(values, { started }),
          }),
      }}
    />
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

  async function handleNext(): Promise<void> {
    if (await form.trigger(META_STEP_FIELDS[current], { shouldFocus: true })) {
      setStep(step + 1);
    }
  }

  const handleCreate = form.handleSubmit(
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
        onJump={setStep}
        onSubmit={() =>
          void (current === "review" ? handleCreate() : handleNext())
        }
        step={step}
        submitLabel={t("submit")}
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

export function WizardSkeleton({
  accountLabel,
  steps,
}: {
  accountLabel?: string;
  steps: number;
}) {
  const t = useTranslations("App.Ads");

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col"
      data-testid="ads-new-campaign-loading"
      role="status"
    >
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="flex shrink-0 gap-1.5 px-6 py-4 md:px-8">
        {Array.from({ length: steps }, (_, index) => (
          <div key={index} className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-[3px] w-full rounded-full" />
            <Skeleton className="hidden h-3 w-16 sm:block" />
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="min-h-0 flex-1 overflow-hidden border-t px-6 py-6 md:px-8 md:py-8"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => (
              <div
                key={index}
                className="flex flex-col gap-5 rounded-xl border p-5"
              >
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-full" />
                </div>
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3 md:px-8">
        <span className="text-muted-foreground truncate text-sm">
          {accountLabel ?? null}
        </span>
        <Skeleton aria-hidden className="h-10 w-28" />
      </div>
    </div>
  );
}
