import type { AnnouncedFeature } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { useHasNewBadge } from "./feature-badges";

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
  const hasNewBadge = useHasNewBadge(feature);
  if (!hasNewBadge) {
    return null;
  }

  return (
    <span
      aria-hidden
      className="bg-primary-quinary text-primary shrink-0 rounded-sm px-[3px] py-px text-[0.5rem] leading-none font-semibold tracking-tight uppercase"
    >
      {t("new")}
    </span>
  );
}
