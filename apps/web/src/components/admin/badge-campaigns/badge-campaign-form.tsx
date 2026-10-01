"use client";

import { AnnouncedFeature, type BadgeCampaign } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
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
 * Dates are entered in UTC: a `datetime-local` value has no zone, and reading
 * it as UTC renders the same on the server and in every admin's browser.
 */
function toUtcInputValue(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function fromUtcInputValue(value: string): string {
  return `${value}:00.000Z`;
}

function addDays(value: string, days: number): string {
  const date = new Date(fromUtcInputValue(value));
  date.setUTCDate(date.getUTCDate() + days);
  return toUtcInputValue(date);
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
    campaign ? toUtcInputValue(campaign.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(
    campaign ? toUtcInputValue(campaign.endsAt) : "",
  );
  // The default end follows the start until the admin sets one themselves.
  const [hasChosenEnd, setHasChosenEnd] = useState(Boolean(campaign));
  const [isPending, startTransition] = useTransition();

  function handleStartsAtChange(value: string) {
    setStartsAt(value);
    if (!hasChosenEnd && value) {
      setEndsAt(addDays(value, DEFAULT_CAMPAIGN_DAYS));
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!feature) {
      toast.error(t("Form.featureRequired"));
      return;
    }

    const campaignWindow = {
      startsAt: fromUtcInputValue(startsAt),
      endsAt: fromUtcInputValue(endsAt),
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
          <Label htmlFor={`${fieldId}-starts`}>{t("Form.startsAt")}</Label>
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
        </p>
        <Button type="submit" disabled={isPending}>
          {campaign ? t("Form.save") : t("Form.create")}
        </Button>
      </div>
    </form>
  );
}
