"use client";

import {
  ProjectSocialProvider,
  type ProjectSocialProvider as ProjectSocialProviderValue,
} from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";
import { Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";

export const SOCIAL_POST_PROVIDERS = Object.values(ProjectSocialProvider);

export function isSocialPostProvider(
  value: string | null,
): value is ProjectSocialProviderValue {
  return (
    value !== null &&
    SOCIAL_POST_PROVIDERS.some((provider) => provider === value)
  );
}

export function socialPlatformFilterSection({
  label,
  allLabel,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: ProjectSocialProviderValue | null;
  onChange: (provider: ProjectSocialProviderValue | null) => void;
}): FilterDropdownMenuSection {
  return {
    id: "provider",
    label,
    icon: Share2,
    value,
    allLabel,
    options: SOCIAL_POST_PROVIDERS.map((provider) => ({
      value: provider,
      label: socialPostProviderLabel(provider),
    })),
    onChange: (provider) =>
      onChange(isSocialPostProvider(provider) ? provider : null),
  };
}

interface SocialPlatformFilterProps {
  value: ProjectSocialProviderValue | null;
  onChange: (provider: ProjectSocialProviderValue | null) => void;
}

/** Same Filters control the Social calendar already uses, for drafts and failures. */
export function SocialPlatformFilter({
  value,
  onChange,
}: SocialPlatformFilterProps) {
  const t = useTranslations("App.Projects.SocialPosts");
  const tFilters = useTranslations("App.Tasks.Filters");

  return (
    <div className="shrink-0" data-testid="social-posts-platform-filter">
      <FilterDropdownMenu
        buttonLabel={tFilters("title")}
        emptyResultsLabel={tFilters("emptyResults")}
        searchPlaceholder={tFilters("searchPlaceholder")}
        sections={[
          socialPlatformFilterSection({
            label: t("filters.platform"),
            allLabel: tFilters("all"),
            value,
            onChange,
          }),
        ]}
        showActiveIndicator={value !== null}
      />
    </div>
  );
}
