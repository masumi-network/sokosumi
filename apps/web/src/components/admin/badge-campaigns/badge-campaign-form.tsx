"use client";

import { AnnouncedFeature, type BadgeCampaign } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
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
import {
  createAdminBadgeCampaignAction,
  updateAdminBadgeCampaignAction,
} from "@/lib/actions/admin-badge-campaigns/action";

/** How long a campaign runs unless the admin picks an end. */
const DEFAULT_CAMPAIGN_DAYS = 21;

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
  const fieldId = useId();
  const [feature, setFeature] = useState<AnnouncedFeature | "">(
    campaign?.feature ?? "",
  );
  const [startsAt, setStartsAt] = useState(
    campaign ? toLocalInputValue(campaign.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(
    campaign ? toLocalInputValue(campaign.endsAt) : "",
  );
  // The default end follows the start until the admin sets one themselves.
  const [hasChosenEnd, setHasChosenEnd] = useState(Boolean(campaign));
  const [isPending, startTransition] = useTransition();
  const timeZone = useBrowserTimeZone();

  function handleStartsAtChange(value: string) {
    setStartsAt(value);
    if (!hasChosenEnd && value) {
      setEndsAt(addDays(value, DEFAULT_CAMPAIGN_DAYS));
    }
  }

  /** The current minute, so the campaign is live the moment it is saved. */
  function handleStartNow() {
    handleStartsAtChange(toLocalInputValue(new Date()));
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
        setEndsAt("");
        setHasChosenEnd(false);
      }
      onSaved?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
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
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${fieldId}-starts`}>{t("Form.startsAt")}</Label>
            {campaign ? null : (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={handleStartNow}
              >
                {t("Form.startNow")}
              </Button>
            )}
          </div>
          <Input
            id={`${fieldId}-starts`}
            type="datetime-local"
            required
            value={startsAt}
            onChange={(event) => handleStartsAtChange(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-ends`}>{t("Form.endsAt")}</Label>
          <Input
            id={`${fieldId}-ends`}
            type="datetime-local"
            required
            min={startsAt || undefined}
            value={endsAt}
            onChange={(event) => {
              setHasChosenEnd(true);
              setEndsAt(event.target.value);
            }}
            aria-describedby={`${fieldId}-ends-help`}
          />
          <p
            id={`${fieldId}-ends-help`}
            className="text-muted-foreground text-xs"
          >
            {t("Form.endsAtHelper", { days: DEFAULT_CAMPAIGN_DAYS })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("Form.audienceHelper")}
          {timeZone ? ` ${t("Form.timeZoneHelper", { timeZone })}` : null}
        </p>
        <Button type="submit" disabled={isPending}>
          {campaign ? t("Form.save") : t("Form.create")}
        </Button>
      </div>
    </form>
  );
}
