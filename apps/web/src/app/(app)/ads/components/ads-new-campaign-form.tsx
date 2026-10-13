"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { GoogleCampaignSpec } from "@sokosumi/core-client";
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
import { createAdCampaign } from "@/lib/actions/ads/action";
import {
  AD_CAMPAIGN_NAME_MAX_LENGTH,
  AD_CAMPAIGN_OBJECTIVES,
} from "@/lib/ads/campaign";
import {
  GOOGLE_DISPLAY_LIMITS,
  googleDisplayFormSchema,
  toGoogleDisplaySpec,
} from "@/lib/ads/google-display";
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
import { AdsFormSection } from "./ads-form-section";
import { AdsGoogleDisplayFields } from "./ads-google-display-fields";
import {
  AdsGoogleDateFields,
  AdsGoogleSearchFields,
} from "./ads-google-search-fields";
import { AdsGoogleTargetingFields } from "./ads-targeting-fields";

interface CampaignFormProps {
  accountId: string;
  currency: string;
  projectId: string;
}

interface GoogleCampaignFormProps extends CampaignFormProps {
  /** Whether the project has a Market profile, which "Add from Market" reads. */
  hasMarketProfile: boolean;
  /** The languages to pick from and the Market profile's suggestions. */
  targeting: GoogleTargeting;
}

/** What a campaign is created with; the project and account come separately. */
interface CampaignDetails {
  name: string;
  dailyBudget: number;
  objective?: (typeof AD_CAMPAIGN_OBJECTIVES)[number];
  google?: GoogleCampaignSpec;
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

/**
 * Creates the campaign and follows the outcome. Core creates it paused and
 * the action revalidates the list, so nothing updates optimistically.
 */
function useCreateCampaign({ accountId, projectId }: CampaignFormProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const router = useRouter();
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [created, setCreated] = useState(false);

  async function create(details: CampaignDetails): Promise<void> {
    setRefusal(null);
    const attempt = (refusal?.attempt ?? 0) + 1;
    try {
      const result = await createAdCampaign({
        projectId,
        accountId,
        ...details,
      });
      if (result.ok) {
        toast.success(t("success"));
        setCreated(true);
        router.push(campaignsHref(projectId, accountId));
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

  return { refusal, created, create };
}

/** Pulls focus (and the view) up from the submit button far below. */
function RefusalAlert({
  projectId,
  refusal,
}: {
  projectId: string;
  refusal: Refusal;
}) {
  const t = useTranslations("App.Ads.newCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const ref = useRef<HTMLDivElement>(null);
  useMountEffect(() => ref.current?.focus());

  const { title, description } = {
    failed: { title: t("errors.failed"), description: null },
    refused: {
      title: t("errors.failed"),
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

interface CampaignFormFrameProps extends CampaignFormProps {
  children: ReactNode;
  creation: ReturnType<typeof useCreateCampaign>;
  onSubmit: () => Promise<void>;
  submitting: boolean;
  /** Pictures are still going in; the campaign waits for them. */
  uploading?: boolean;
}

/** The form element around a provider's fields: the failure above, actions below. */
function CampaignFormFrame({
  accountId,
  children,
  creation,
  onSubmit,
  projectId,
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
      {creation.refusal ? (
        // A new key per attempt re-mounts the alert, which focuses it again.
        <RefusalAlert
          key={creation.refusal.attempt}
          projectId={projectId}
          refusal={creation.refusal}
        />
      ) : null}
      {children}
      <div className="flex items-center justify-end gap-3">
        {/* Always there, so the wait is announced when it starts. */}
        <span className="text-muted-foreground mr-auto text-sm" role="status">
          {uploading ? t("uploadingImages") : null}
        </span>
        <Button asChild variant="ghost">
          <Link href={campaignsHref(projectId, accountId)}>
            {tCampaigns("cancel")}
          </Link>
        </Button>
        <Button
          disabled={uploading}
          loading={submitting || creation.created}
          type="submit"
        >
          {t("submit")}
        </Button>
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
  const creation = useCreateCampaign(props);
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

  return (
    <Form {...form}>
      <CampaignFormFrame
        {...props}
        creation={creation}
        onSubmit={form.handleSubmit(({ name, dailyBudget, objective }) =>
          creation.create({
            name,
            dailyBudget: Number(dailyBudget),
            objective: AD_CAMPAIGN_OBJECTIVES.find(
              (candidate) => candidate === objective,
            ),
          }),
        )}
        submitting={form.formState.isSubmitting}
      >
        <AdsFormSection id="new-campaign-basics" title={t("sections.basics")}>
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
        </AdsFormSection>
      </CampaignFormFrame>
    </Form>
  );
}

const GOOGLE_TYPES = ["SEARCH", "DISPLAY"] as const;
type GoogleType = (typeof GOOGLE_TYPES)[number];

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

function blankTexts(count: number): string[] {
  return Array.from({ length: count }, () => "");
}

/** What a Google form starts with: the fields of both types, one shown. */
const EMPTY_GOOGLE_VALUES = {
  type: "SEARCH" as GoogleType,
  name: "",
  dailyBudget: "",
  startDate: "",
  endDate: "",
  finalUrl: "",
  keywords: "",
  path1: "",
  path2: "",
  headlines: blankTexts(GOOGLE_SEARCH_LIMITS.headlines.min),
  descriptions: blankTexts(GOOGLE_SEARCH_LIMITS.descriptions.min),
  sitelinks: [],
  callouts: [],
  businessName: "",
  displayHeadlines: blankTexts(GOOGLE_DISPLAY_LIMITS.headlines.min),
  longHeadline: "",
  displayDescriptions: blankTexts(GOOGLE_DISPLAY_LIMITS.descriptions.min),
  images: [],
};

/** Search or Display. Switching keeps what both share and swaps the rest. */
function GoogleTypePicker() {
  const t = useTranslations("App.Ads.newCampaign");
  const form = useFormContext<typeof EMPTY_GOOGLE_VALUES>();

  return (
    <AdsFormSection id="new-campaign-type" title={t("sections.type")}>
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
    </AdsFormSection>
  );
}

/**
 * A Google campaign, Search or Display: the type is picked at the top, and the
 * name, budget, dates, targeting and final URL stay when it changes. Core's
 * rules per type are the Search keywords and responsive search ad, or the
 * Display images and responsive display ad.
 */
export function GoogleCampaignForm({
  hasMarketProfile,
  targeting,
  ...props
}: GoogleCampaignFormProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const creation = useCreateCampaign(props);
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
    // The Market profile's suggestions start the pickers; the reader may remove them.
    defaultValues: {
      ...EMPTY_GOOGLE_VALUES,
      locations: targeting.defaultLocations,
      languages: targeting.defaultLanguages,
    },
  });
  const [uploading, setUploading] = useState(false);
  const type = form.watch("type");

  return (
    <Form {...form}>
      <ImageUploadContext value={{ uploading, setUploading }}>
        <CampaignFormFrame
          {...props}
          creation={creation}
          onSubmit={form.handleSubmit((values) =>
            creation.create({
              name: values.name.trim(),
              dailyBudget: Number(values.dailyBudget),
              google:
                values.type === "SEARCH"
                  ? toGoogleSearchSpec(values)
                  : toGoogleDisplaySpec(values),
            }),
          )}
          submitting={form.formState.isSubmitting}
          uploading={uploading}
        >
          <GoogleTypePicker />
          <AdsFormSection id="new-campaign-basics" title={t("sections.basics")}>
            <NameAndBudgetFields budget={budget} />
            <AdsGoogleDateFields />
          </AdsFormSection>
          <AdsFormSection
            id="new-campaign-targeting"
            title={t("sections.targeting")}
          >
            <AdsGoogleTargetingFields
              accountId={props.accountId}
              languageOptions={targeting.languageOptions}
              projectId={props.projectId}
            />
          </AdsFormSection>
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
