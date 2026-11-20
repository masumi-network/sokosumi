"use client";

import { debounce, defaultRateLimit, useQueryState } from "nuqs";
import {
  type ComponentProps,
  type TransitionStartFunction,
  useTransition,
} from "react";
import { PageSearchField } from "@/components/page-search-field";
import { getEnvPublicConfig } from "@/config/env.public";

/** The common query bound for paginated overview searches. */
const DEFAULT_PAGE_SEARCH_MAX_LENGTH = 200;

type PageQuerySearchFieldProps = Pick<
  ComponentProps<typeof PageSearchField>,
  "placeholder" | "inHeader" | "className" | "clearLabel" | "maxLength"
> & { startTransition?: TransitionStartFunction };

export function pageSearchUrlUpdates(value: string) {
  return {
    limitUrlUpdates: value
      ? debounce(getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME)
      : defaultRateLimit,
  };
}

/** Search the full collection on the server while keeping the field focused. */
export function PageQuerySearchField({
  startTransition,
  maxLength = DEFAULT_PAGE_SEARCH_MAX_LENGTH,
  ...field
}: PageQuerySearchFieldProps) {
  const [, startSearchTransition] = useTransition();
  const [query, setQuery] = useQueryState("q", {
    defaultValue: "",
    shallow: false,
    clearOnDefault: true,
    startTransition: startTransition ?? startSearchTransition,
  });
  return (
    <PageSearchField
      {...field}
      maxLength={maxLength}
      value={query}
      onValueChange={(next) => {
        void setQuery(next, pageSearchUrlUpdates(next));
      }}
    />
  );
}
