"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type PageDetailItem,
  pageDetailItemHref,
  pageDetailItemName,
  pageDetailLinkName,
} from "./seo-overview-model";

/** A note's first items always show; the rest of its list opens on request. */
const FIRST_ITEMS = 3;

/** "Too many requests": the site turned the check away for a moment, so the link is not known to be broken. */
const RETRY_STATUS = "429";

/** A three-digit HTTP status shows as a badge; any other answer stays text. */
const HTTP_STATUS = /^\d{3}$/;

/** A 4xx or 5xx answer is an error and gets the solid badge; a redirect or a 429 stays quiet. */
const ERROR_STATUS = /^[45]\d\d$/;

const isError = (status: string) =>
  ERROR_STATUS.test(status) && status !== RETRY_STATUS;

/** The files or links a note flagged: the first few, then the others behind a toggle. */
export function SeoPageDetailItemList({
  values,
  more,
  pageUrl,
}: {
  values: readonly PageDetailItem[];
  /** Items the check counted but did not list. */
  more: number;
  pageUrl: string;
}) {
  const t = useTranslations("App.Seo.overview");
  const [open, setOpen] = useState(false);
  const restId = useId();
  const rest = values.slice(FIRST_ITEMS);
  const shown = open ? values : values.slice(0, FIRST_ITEMS);
  // Unlisted items have nothing to open, so they show with the list's end.
  const unlisted = more && (open || !rest.length);
  return (
    <div className="space-y-1.5">
      <ul
        id={restId}
        className="border-border divide-border divide-y rounded-md border"
      >
        {shown.map(({ value, status }, index) => {
          const label =
            status === undefined
              ? (pageDetailItemName(value) ?? t("inlineImage"))
              : pageDetailLinkName(value, pageUrl);
          const href = pageDetailItemHref(value);
          return (
            <li
              key={`${index}:${value}`}
              className="flex min-w-0 items-center gap-2.5 px-3 py-2"
            >
              <span className="min-w-0 flex-1 font-mono text-xs break-all">
                {href ? (
                  <a
                    href={href}
                    title={value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    {label}
                  </a>
                ) : (
                  label
                )}
              </span>
              {status === undefined ? null : (
                <>
                  {/* The arrow parts link and status for a screen reader, as it did before the badge. */}
                  <span className="sr-only"> → </span>
                  {HTTP_STATUS.test(status) ? (
                    <Badge
                      variant={isError(status) ? "destructive" : "outline"}
                      className={cn(
                        "text-2xs px-1.5 font-mono",
                        !isError(status) && "text-muted-foreground",
                      )}
                    >
                      {status}
                    </Badge>
                  ) : (
                    // Any other answer is words, not a code: it wraps instead of pushing the link out of the row.
                    <span className="text-muted-foreground max-w-[50%] text-xs break-words">
                      {status}
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
        {unlisted ? (
          <li className="text-muted-foreground px-3 py-2 text-xs">
            {t("unlistedItems", { count: more })}
          </li>
        ) : null}
      </ul>
      {rest.length ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={restId}
          onClick={() => setOpen((was) => !was)}
          className="focus-visible:ring-ring rounded-sm py-1 text-xs font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          {open ? t("showLess") : t("showMoreItems", { count: rest.length })}
        </button>
      ) : null}
    </div>
  );
}
