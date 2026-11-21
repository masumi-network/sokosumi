"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  Binoculars,
  Brain,
  CalendarDays,
  ChartLine,
  House,
  type LucideIcon,
  MessageSquare,
  Search,
  Settings,
  Share2,
  Target,
} from "lucide-react";
import { needsYou } from "../../lib/today";
import type { View } from "../../lib/views";
import { AccountMenu } from "../account-menu";
import { hostOf } from "../brand-profile";
import { BusinessMark, businessDisplayName } from "../business-mark";
import { CusoStatus } from "./cuso-status";
import { ViewLink } from "./view-link";

type Page = readonly [View, string, LucideIcon];

/** Where the owner goes every day. */
const MAIN = [
  ["today", "Today", House],
  ["chat", "Chat", MessageSquare],
  ["calendar", "Calendar", CalendarDays],
  ["results", "Results", ChartLine],
] as const satisfies readonly Page[];

/** What Cuso works from: the owner's brand, a quiet group of its own. */
const BRAND = [
  ["strategy", "Strategy", Target],
  ["brain", "Brand Brain", Brain],
  ["competitors", "Competitors", Binoculars],
  ["seo", "SEO", Search],
  ["channels", "Channels", Share2],
] as const satisfies readonly Page[];

/** Every page; Settings opens from the account menu. */
export const VIEWS = [
  ...MAIN,
  ...BRAND,
  ["settings", "Settings", Settings],
] as const satisfies readonly Page[];

/** First letter for the person avatar chip. */
export function initial(text: string): string {
  return text.trim().charAt(0).toUpperCase() || "?";
}

interface SidebarProps {
  overview: CmoOverview;
  view: View;
  onSelect: (view: View) => void;
  name: string;
  email: string;
  signOut?: () => Promise<void>;
  /** The person has another Cuso, so "Your Cusos" leads somewhere. */
  manyCusos?: boolean;
  /** Pins the time Cuso's "just filed" report counts from (previews, tests). */
  now?: Date;
}

/**
 * The app's sidebar: the Business and the person on top, the pages, and
 * Cuso on his stage at the foot.
 */
export function Sidebar({
  overview,
  view,
  onSelect,
  name,
  email,
  signOut,
  manyCusos = false,
  now,
}: SidebarProps) {
  const needs = needsYou(overview).length;
  const link = ([id, label]: Page) => (
    <ViewLink
      key={id}
      view={id}
      open={onSelect}
      className={view === id ? "active" : ""}
      aria-current={view === id ? "page" : undefined}
    >
      <span className="nav-label">{label}</span>
      {id === "today" && needs > 0 ? (
        <span className="count num" aria-label={`${needs} need you`}>
          {needs}
        </span>
      ) : null}
    </ViewLink>
  );
  return (
    <nav className="side" aria-label="Main">
      <header className="side-head">
        <BusinessMark overview={overview} size={38} />
        <span className="side-name">
          <b>{businessDisplayName(overview)}</b>
          <a href={overview.websiteUrl} target="_blank" rel="noreferrer">
            {hostOf(overview.websiteUrl)}
          </a>
        </span>
        <AccountMenu
          label={`Account: ${name || email}`}
          signOut={signOut}
          cusoPicker={manyCusos}
          trigger={
            <span
              className={
                view === "settings" ? "avatar avatar-active" : "avatar"
              }
              aria-hidden="true"
            >
              {initial(name || email)}
            </span>
          }
        >
          {(close) => (
            <>
              <p className="ob-who-person">
                <b>{name || email}</b>
                {name ? <span className="note">{email}</span> : null}
              </p>
              <ViewLink
                view="settings"
                open={(next) => {
                  close();
                  onSelect(next);
                }}
                className="ob-who-item"
                aria-current={view === "settings" ? "page" : undefined}
              >
                <Settings size={14} aria-hidden="true" />
                Settings
              </ViewLink>
            </>
          )}
        </AccountMenu>
      </header>
      <div className="nav">
        <div className="nav-main">{MAIN.map(link)}</div>
        <p className="nav-group" id="nav-brand">
          Your brand
        </p>
        <div className="nav-brand" role="group" aria-labelledby="nav-brand">
          {BRAND.map(link)}
        </div>
      </div>
      <CusoStatus overview={overview} view={view} now={now} onOpen={onSelect} />
    </nav>
  );
}
