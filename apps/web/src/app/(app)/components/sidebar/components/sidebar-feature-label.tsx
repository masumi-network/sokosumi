import type { AnnouncedFeature } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

import { useNewBadgeState } from "./feature-badges";

/**
 * The label span's classes for a row that can carry a "New" pill: one line
 * where the pill always shows and the name takes the rest, truncating only if
 * a translation is too long for the row.
 */
export const SIDEBAR_FEATURE_LABEL_CLASS = "flex min-w-0 items-center gap-x-1";

/**
 * A nav row's name, followed by a compact "New" pill while a Badge campaign
 * for its Announced feature runs for this reader. The pill streams in on its
 * own, so the name never waits for it.
 */
export function SidebarFeatureLabel({
  label,
  feature,
}: {
  label: string;
  feature: AnnouncedFeature;
}) {
  return (
    <>
      <span className="min-w-0 truncate">{label}</span>
      <Suspense fallback={null}>
        <NewPill feature={feature} />
      </Suspense>
    </>
  );
}

function NewPill({ feature }: { feature: AnnouncedFeature }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  const state = useNewBadgeState(feature);
  if (state === "none") {
    return null;
  }

  // The pill's caps are styling; the row's accessible name gets ", New" from
  // the hidden copy, since flex items join without a space. Leaving, it fades
  // on opacity alone (`PILL_FADE_MS`); reduced motion skips the fade.
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "bg-primary-quinary text-primary shrink-0 rounded-sm px-1 py-0.5 text-2xs leading-none font-semibold tracking-wide uppercase",
          "transition-opacity duration-200 ease-out motion-reduce:transition-none",
          state === "fading" && "opacity-0",
        )}
      >
        {t("new")}
      </span>
      <span className="sr-only">, {t("new")}</span>
    </>
  );
}
