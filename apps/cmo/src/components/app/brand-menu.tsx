"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowUpRight,
  Binoculars,
  Brain,
  ChevronDown,
  type LucideIcon,
  Search,
  Share2,
  Target,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useEventListener } from "../../hooks/effects/use-event-listener";
import type { View } from "../../lib/views";
import { hostOf } from "../brand-profile";
import { BusinessMark, businessDisplayName } from "../business-mark";
import { ViewLink } from "./view-link";

/** What Cuso works from and on: the brand's own pages, behind the brand's name. */
export const BRAND_PAGES = [
  ["strategy", "Strategy", Target],
  ["brain", "Brand Brain", Brain],
  ["competitors", "Competitors", Binoculars],
  ["seo", "SEO", Search],
  ["channels", "Channels", Share2],
] as const satisfies readonly (readonly [View, string, LucideIcon])[];

const BRAND_VIEWS: ReadonlySet<View> = new Set(
  BRAND_PAGES.map(([view]) => view),
);

/** True on a page the brand menu holds. */
export function isBrandPage(view: View): boolean {
  return BRAND_VIEWS.has(view);
}

interface BrandMenuProps {
  overview: CmoOverview;
  view: View;
  onSelect: (view: View) => void;
}

/**
 * The business at the head of the sidebar (and a phone's top bar) as a menu
 * button: it opens the brand's pages and the site. It reads as the page you
 * are on while one of them is open.
 */
export function BrandMenu({ overview, view, onSelect }: BrandMenuProps) {
  const [open, setOpen] = useState(false);
  // Opened from the keyboard, the first page takes focus; from a pointer the
  // menu itself does, so no ring shows until a key moves it.
  const [fromKeys, setFromKeys] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const host = hostOf(overview.websiteUrl);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  useEventListener("document", "pointerdown", (event) => {
    if (open && !root.current?.contains(event.target as Node)) close(false);
  });

  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(event.currentTarget.querySelectorAll<HTMLElement>(
        "[role=menuitem]",
      ) ?? []),
    ];
    // From the menu itself (opened by a pointer), the arrows start at an end.
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = at < 0 && step < 0 ? items.length - 1 : at + step;
      items[(next + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items.at(-1))?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div className="brand" ref={root}>
      <button
        ref={button}
        type="button"
        className="brand-button"
        data-active={isBrandPage(view) ? "" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          setFromKeys(event.detail === 0);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setFromKeys(true);
            setOpen(true);
          }
        }}
      >
        <BusinessMark overview={overview} size={36} />
        <span className="brand-name">
          <b>{businessDisplayName(overview)}</b>
          <span>{host}</span>
        </span>
        <ChevronDown size={16} className="brand-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={businessDisplayName(overview)}
          className="brand-menu"
          tabIndex={-1}
          ref={(menu) => {
            const first = menu?.querySelector<HTMLElement>("[role=menuitem]");
            (fromKeys ? first : menu)?.focus();
          }}
          onKeyDown={onMenuKey}
        >
          {BRAND_PAGES.map(([id, label, Icon]) => (
            <ViewLink
              key={id}
              view={id}
              role="menuitem"
              open={(next) => {
                close(false);
                onSelect(next);
              }}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </ViewLink>
          ))}
          <a
            role="menuitem"
            className="brand-menu-site"
            href={overview.websiteUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => close(false)}
          >
            <ArrowUpRight size={16} aria-hidden="true" />
            Open {host}
          </a>
        </div>
      ) : null}
    </div>
  );
}
