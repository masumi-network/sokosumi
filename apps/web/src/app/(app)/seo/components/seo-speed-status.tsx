import { Check, type LucideIcon, Minus, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import type {
  SeoDeviceVerdict,
  SeoSpeedVerdict,
  SeoVital,
  SeoVitalStatus,
} from "./seo-speed-model";

// Green and yellow are fills under a dark glyph. The glyph's shape and the word beside it carry the status.
const MARKS: Record<SeoVitalStatus, { icon: LucideIcon; disc: string }> = {
  good: {
    icon: Check,
    disc: "bg-semantic-success text-semantic-success-foreground",
  },
  needs_improvement: {
    icon: TriangleAlert,
    disc: "bg-semantic-warning text-semantic-warning-foreground",
  },
  poor: {
    icon: X,
    disc: "bg-semantic-destructive-solid text-semantic-destructive-foreground",
  },
  too_little_data: { icon: Minus, disc: "bg-quinary text-muted-foreground" },
};

/** A speed status: a glyph in a disc and the status in words. The words default to the status name. */
export function SeoSpeedMark({
  status,
  children,
}: {
  status: SeoVitalStatus;
  children?: ReactNode;
}) {
  const t = useSeoResultTranslations("App.Seo.pageSpeed");
  const { icon: Icon, disc } = MARKS[status];
  return (
    <span className="inline-flex items-start gap-1.5">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          disc,
        )}
      >
        <Icon className="size-3" />
      </span>
      {/* The icon shows the severity; a screen reader gets it as text before the verdict. */}
      <span className="min-w-0">
        {children ? (
          <>
            <span className="sr-only">{t(`status.${status}`)}: </span>
            <span>{children}</span>
          </>
        ) : (
          t(`status.${status}`)
        )}
      </span>
    </span>
  );
}

/** A verdict in words; one over a limit names the Core Web Vitals that are over it. */
export function seoSpeedVerdictText(
  t: ReturnType<typeof useSeoResultTranslations<"App.Seo">>,
  {
    verdict,
    over,
    passOn,
  }: {
    verdict: SeoSpeedVerdict;
    over: SeoVital[];
    passOn?: SeoDeviceVerdict["device"][] | null;
  },
) {
  if (verdict === "pass" && passOn)
    return t("pageSpeed.verdict.passOn", {
      devices: passOn
        .map((device) => t(`breakdown.devices.${device}`).toLowerCase())
        .join(", "),
    });
  return verdict === "over"
    ? t("pageSpeed.verdict.over", {
        metrics: over
          .map((metric) => t(`pageSpeed.metricShort.${metric}`))
          .join(", "),
      })
    : t(`pageSpeed.verdict.${verdict}`);
}
