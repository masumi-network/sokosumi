"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  type PageDetailItem,
  pageDetailItemHref,
  pageDetailItemName,
  pageDetailLinkName,
} from "./seo-overview-model";

/** A note's first items always show; the rest of its list opens on request. */
const FIRST_ITEMS = 3;

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
    <div className="space-y-0.5">
      <ul id={restId} className="space-y-0.5">
        {shown.map(({ value, status }, index) => {
          const label =
            status === undefined
              ? (pageDetailItemName(value) ?? t("inlineImage"))
              : pageDetailLinkName(value, pageUrl);
          const href = pageDetailItemHref(value);
          return (
            <li key={`${index}:${value}`} className="min-w-0 break-all">
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
              {status === undefined ? null : (
                <span className="text-muted-foreground tabular-nums">
                  {" → "}
                  {status}
                </span>
              )}
            </li>
          );
        })}
        {unlisted ? (
          <li className="text-muted-foreground">
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
          className="focus-visible:ring-ring rounded-sm py-1 underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          {open ? t("showLess") : t("showMoreItems", { count: rest.length })}
        </button>
      ) : null}
    </div>
  );
}
