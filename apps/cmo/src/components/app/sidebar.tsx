"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  CalendarDays,
  ChartLine,
  House,
  type LucideIcon,
  MessageSquare,
  Settings,
} from "lucide-react";
import { needsYou } from "../../lib/today";
import type { View } from "../../lib/views";
import { AccountMenu } from "../account-menu";
import { BRAND_PAGES, BrandMenu } from "./brand-menu";
import { CusoStatus } from "./cuso-status";
import { ViewLink } from "./view-link";

type Page = readonly [View, string, LucideIcon];

/** Where the owner goes every day; the brand's pages sit behind its name. */
const MAIN = [
  ["today", "Today", House],
  ["chat", "Chat", MessageSquare],
  ["calendar", "Calendar", CalendarDays],
  ["results", "Results", ChartLine],
] as const satisfies readonly Page[];

/** Every page; Settings opens from the account menu. */
export const VIEWS = [
  ...MAIN,
  ...BRAND_PAGES,
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
  /** The account's picture; without one the avatar shows the initial. */
  image?: string | null;
  signOut?: () => Promise<void>;
  /** The person has another Cuso, so "Your Cusos" leads somewhere. */
  manyCusos?: boolean;
  /** Pins the time Cuso's "just filed" report counts from (previews, tests). */
  now?: Date;
}

/**
 * The app's sidebar: the Business (a menu of its pages) and the person on
 * top, the daily pages, and Cuso on his stage at the foot.
 */
export function Sidebar({
  overview,
  view,
  onSelect,
  name,
  email,
  image = null,
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
        <BrandMenu overview={overview} view={view} onSelect={onSelect} />
        <AccountMenu
          label={`Account: ${name || email}`}
          signOut={signOut}
          cusoPicker={manyCusos}
          trigger={
            // The picked page's fill marks Settings as open.
            <span
              className={
                view === "settings"
                  ? "avatar-ring avatar-ring-active"
                  : "avatar-ring"
              }
              aria-hidden="true"
            >
              {image ? (
                <img
                  className="avatar avatar-photo"
                  src={image}
                  alt=""
                  width={36}
                  height={36}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="avatar avatar-initial">
                  {initial(name || email)}
                </span>
              )}
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
      </div>
      <CusoStatus overview={overview} view={view} now={now} onOpen={onSelect} />
    </nav>
  );
}
