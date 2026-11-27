"use client";

import {
  createParser,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { type SeoTab, seoTab } from "@/app/seo/seo-query";
import { SEO_SEARCH_TYPES, SEO_TRAFFIC_CHANNELS } from "./seo-traffic-model";
import { seoFilterDayValid } from "./seo-workspace-selection";

// Old tab names in saved links open the tab that now holds their content.
const parseAsSeoTab = createParser<SeoTab>({
  parse: seoTab,
  serialize: (tab) => tab,
});

/**
 * The filters of the SEO workspace, kept in the URL: the tab, the page selection, the dates and
 * the Traffic controls. `query` is the search string of the workspace read.
 */
export function useSeoFilters(onLeaveActions: () => void) {
  const [urlFilters, setUrlFilters] = useQueryStates({
    tab: parseAsSeoTab.withDefault("agent"),
    pageId: parseAsString,
    scopeId: parseAsString,
    from: parseAsString,
    to: parseAsString,
    channel: parseAsStringLiteral(SEO_TRAFFIC_CHANNELS),
    searchType: parseAsStringLiteral(SEO_SEARCH_TYPES),
  });
  // The search type and the channel are Traffic controls: every other tab reads web search in every
  // channel, and leaving Traffic clears both. A channel kept there hid organic Search Console data.
  const filters =
    urlFilters.tab === "traffic"
      ? urlFilters
      : { ...urlFilters, searchType: null, channel: null };
  const setFilters: typeof setUrlFilters = (values, options) => {
    if (
      typeof values !== "function" &&
      values?.tab &&
      values.tab !== "actions"
    ) {
      onLeaveActions();
    }
    return setUrlFilters(
      typeof values !== "function" && values?.tab && values.tab !== "traffic"
        ? { ...values, searchType: null, channel: null }
        : values,
      options,
    );
  };
  const query = new URLSearchParams();
  for (const key of [
    "pageId",
    "scopeId",
    "from",
    "to",
    "channel",
    "searchType",
  ] as const) {
    if (filters[key]) query.set(key, filters[key]);
  }
  // A day in another form, or an end before the start: Core refuses both, so the page reads nothing and says why.
  const invalidDates =
    [filters.from, filters.to].some((day) => day && !seoFilterDayValid(day)) ||
    Boolean(filters.from && filters.to && filters.from > filters.to);
  return { filters, setFilters, query, invalidDates };
}
