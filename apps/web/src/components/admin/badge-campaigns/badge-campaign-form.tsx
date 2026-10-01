"use client";

import { AnnouncedFeature, type BadgeCampaign } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import {
  type FormEvent,
  useId,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  createAdminBadgeCampaignAction,
  updateAdminBadgeCampaignAction,
} from "@/lib/actions/admin-badge-campaigns/action";
import { cn } from "@/lib/utils";

/** The lengths offered, in days; the last is the default. */
const DURATION_DAYS = [7, 14, 21] as const;
const DEFAULT_DURATION = "21";
const CUSTOM_DURATION = "custom";
/** The chosen length takes the tint the app uses for what is on. */
const DURATION_ITEM_CLASS =
  "data-[state=on]:bg-primary-quaternary data-[state=on]:text-primary-variant data-[state=on]:font-medium";

/**
 * Dates are entered in the admin's own time zone and sent to Core as UTC. A
 * `datetime-local` value has no zone, and the browser reads it as local time.
 * The form only shows a date the admin typed or one from the edit dialog,
 * which renders in the browser alone, so server and client never disagree.
 */
function toLocalInputValue(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}

/** Calendar days, so the end keeps its wall-clock time across a DST change. */
function addDays(value: string, days: number): string {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return toLocalInputValue(date);
}

/** The offered length a saved campaign matches, or custom when it fits none. */
function durationOf(campaign: BadgeCampaign): string {
  const start = toLocalInputValue(campaign.startsAt);
  const end = toLocalInputValue(campaign.endsAt);
  const days = DURATION_DAYS.find((length) => addDays(start, length) === end);
  return days ? String(days) : CUSTOM_DURATION;
}

function subscribeToNothing() {
  return () => {};
}

/** The browser's time zone; unknown while rendering on the server. */
function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(
    subscribeToNothing,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
}

/** Each feature's name as the sidebar shows it, so admins pick what users see. */
export type AnnouncedFeatureLabels = Record<AnnouncedFeature, string>;

interface BadgeCampaignFormProps {
  featureLabels: AnnouncedFeatureLabels;
  /** Edit this campaign's dates. Omitted, the form creates a campaign. */
  campaign?: BadgeCampaign;
  onSaved?: () => void;
}

export function BadgeCampaignForm({
  featureLabels,
  campaign,
  onSaved,
}: BadgeCampaignFormProps) {
  const t = useTranslations("App.Admin.BadgeCampaigns");
  const formatter = useFormatter();
  const fieldId = useId();
  const [feature, setFeature] = useState<AnnouncedFeature | "">(
    campaign?.feature ?? "",
  );
  const [startsAt, setStartsAt] = useState(
    campaign ? toLocalInputValue(campaign.startsAt) : "",
  );
  // A length in days, or custom with its own end.
  const [duration, setDuration] = useState(
    campaign ? durationOf(campaign) : DEFAULT_DURATION,
  );
  const [customEndsAt, setCustomEndsAt] = useState(
    campaign ? toLocalInputValue(campaign.endsAt) : "",
  );
  const [isPending, startTransition] = useTransition();
  const timeZone = useBrowserTimeZone();

  const isCustom = duration === CUSTOM_DURATION;
  const endsAt = isCustom
    ? customEndsAt
    : startsAt
      ? addDays(startsAt, Number(duration))
      : "";

  /** The current minute, so the campaign is live the moment it is saved. */
  function handleStartNow() {
    setStartsAt(toLocalInputValue(new Date()));
  }

  function handleDurationChange(value: string) {
    // Radix reports "" when the pressed item is pressed again; keep a choice.
    if (!value) return;
    // Custom starts from the end the admin was already looking at.
    if (value === CUSTOM_DURATION && !customEndsAt) setCustomEndsAt(endsAt);
    setDuration(value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!feature) {
      toast.error(t("Form.featureRequired"));
      return;
    }

    const campaignWindow = {
      startsAt: fromLocalInputValue(startsAt),
      endsAt: fromLocalInputValue(endsAt),
    };

    startTransition(async () => {
      const result = campaign
        ? await updateAdminBadgeCampaignAction({
            input: { id: campaign.id, ...campaignWindow },
          })
        : await createAdminBadgeCampaignAction({
            input: { feature, ...campaignWindow },
          });

      if (!result.ok) {
        toast.error(t("Toasts.saveFailed"), {
          description: result.error.message,
        });
        return;
      }

      toast.success(campaign ? t("Toasts.updated") : t("Toasts.created"));
      if (!campaign) {
        setFeature("");
        setStartsAt("");
        setDuration(DEFAULT_DURATION);
        setCustomEndsAt("");
      }
      onSaved?.();
    });
  }

  // Date fields share the select's filled surface, and the native picker
  // icon follows the theme.
  const dateInputClass = "dark:bg-quinary dark:[color-scheme:dark]";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Columns may shrink below their content; the date field alone won't. */}
      <div className="grid items-start gap-x-4 gap-y-5 *:min-w-0 lg:grid-cols-[1fr_1.4fr_1.3fr]">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-feature`}>{t("Form.feature")}</Label>
          <Select
            value={feature}
            onValueChange={(value) => setFeature(value as AnnouncedFeature)}
            disabled={Boolean(campaign)}
            required
          >
            <SelectTrigger id={`${fieldId}-feature`} className="w-full">
              <SelectValue placeholder={t("Form.featurePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {Object.values(AnnouncedFeature).map((value) => (
                <SelectItem key={value} value={value}>
                  {featureLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-starts`}>{t("Form.startsAt")}</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${fieldId}-starts`}
              type="datetime-local"
              required
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              aria-describedby={`${fieldId}-starts-help`}
              className={cn("min-w-48 flex-1", dateInputClass)}
            />
            {campaign ? null : (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={handleStartNow}
              >
                {t("Form.startNow")}
              </Button>
            )}
          </div>
          <p
            id={`${fieldId}-starts-help`}
            className="text-muted-foreground min-h-4 text-xs"
          >
            {timeZone ? t("Form.timeZoneHelper", { timeZone }) : null}
          </p>
        </div>
        <div className="space-y-2">
          <Label id={`${fieldId}-duration-label`}>{t("Form.runsFor")}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="lg"
            value={duration}
            onValueChange={handleDurationChange}
            aria-labelledby={`${fieldId}-duration-label`}
            aria-describedby={`${fieldId}-ends-help`}
            className="w-full"
          >
            {DURATION_DAYS.map((days) => (
              <ToggleGroupItem
                key={days}
                value={String(days)}
                className={DURATION_ITEM_CLASS}
              >
                {t("Form.weeks", { count: days / 7 })}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem
              value={CUSTOM_DURATION}
              className={DURATION_ITEM_CLASS}
            >
              {t("Form.custom")}
            </ToggleGroupItem>
          </ToggleGroup>
          {isCustom ? (
            <Input
              id={`${fieldId}-ends`}
              type="datetime-local"
              required
              aria-label={t("Form.endsAt")}
              min={startsAt || undefined}
              value={customEndsAt}
              onChange={(event) => setCustomEndsAt(event.target.value)}
              className={dateInputClass}
            />
          ) : null}
          {/* With Custom the end field says it; the line would only repeat it. */}
          {isCustom ? null : (
            <p
              id={`${fieldId}-ends-help`}
              className="text-muted-foreground min-h-4 text-xs"
            >
              {endsAt
                ? t("Form.endsOn", {
                    date: formatter.dateTime(
                      new Date(endsAt),
                      "dateTimeMedium",
                    ),
                  })
                : t("Form.endsPending")}
            </p>
          )}
        </div>
      </div>
      <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          {t("Form.audienceHelper")}
        </p>
        <Button type="submit" disabled={isPending} className="sm:shrink-0">
          {campaign ? t("Form.save") : t("Form.create")}
        </Button>
      </div>
    </form>
  );
}
