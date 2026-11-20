"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowUpRight,
  Binoculars,
  Brain,
  CalendarDays,
  ChartLine,
  ChevronsUpDown,
  House,
  type LucideIcon,
  MessageSquare,
  Search,
  Settings,
  Share2,
  Target,
} from "lucide-react";
import { AGENT_NAME } from "../../lib/agent";
import { needsYou } from "../../lib/today";
import type { View } from "../../lib/views";
import { AccountMenu } from "../account-menu";
import { hostOf } from "../brand-profile";
import { BusinessMark, businessDisplayName } from "../business-mark";
import { CusoStatus } from "./cuso-status";
import { ViewLink } from "./view-link";

export const VIEWS = [
  ["today", "Today", House],
  ["chat", AGENT_NAME, MessageSquare],
  ["strategy", "Strategy", Target],
  ["calendar", "Calendar", CalendarDays],
  ["seo", "SEO", Search],
  ["results", "Results", ChartLine],
  ["competitors", "Competitors", Binoculars],
  ["brain", "Brand Brain", Brain],
  ["channels", "Channels", Share2],
  ["settings", "Settings", Settings],
] as const satisfies readonly (readonly [View, string, LucideIcon])[];

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
 * The head of the sidebar, the Business this Cuso works for: its own logo
 * (read from its DESIGN.md while hiring), else its mark and name; its site;
 * and, when the person has another Cuso, the switch to the Cuso picker.
 */
function BusinessHead({
  overview,
  manyCusos,
}: {
  overview: CmoOverview;
  manyCusos: boolean;
}) {
  const host = hostOf(overview.websiteUrl);
  const name = businessDisplayName(overview);
  const logos = overview.brandMedia?.logos;
  const logo = logos?.logo?.url;
  return (
    <header className="side-head">
      {logo ? (
        <span className="side-logo" role="img" aria-label={name}>
          <img className="side-logo-light" src={logo} alt="" />
          <img
            className="side-logo-dark"
            src={logos?.dark?.url ?? logo}
            alt=""
          />
        </span>
      ) : (
        <span className="side-name">
          <BusinessMark overview={overview} size={32} />
          <b>{name}</b>
        </span>
      )}
      <span className="side-head-row">
        <a
          className="side-site"
          href={overview.websiteUrl}
          target="_blank"
          rel="noreferrer"
        >
          {logo || host !== name ? host : "Open site"}
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
        {/* The Cuso picker: switch Business or hire another (ADR 0065). */}
        {manyCusos ? (
          <a className="side-switch" href="/?cusos=1">
            <ChevronsUpDown size={14} aria-hidden="true" />
            Your {AGENT_NAME}s
          </a>
        ) : null}
      </span>
    </header>
  );
}

/** The app's sidebar: the Business, pages, Cuso and the person. */
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
  return (
    <nav className="side" aria-label="Main">
      <BusinessHead overview={overview} manyCusos={manyCusos} />
      <div className="nav">
        {VIEWS.map(([id, label, Icon]) => (
          <ViewLink
            key={id}
            view={id}
            open={onSelect}
            className={view === id ? "active" : ""}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="nav-label">{label}</span>
            {id === "today" && needs > 0 ? (
              <span className="count num" aria-label={`${needs} need you`}>
                {needs}
              </span>
            ) : null}
          </ViewLink>
        ))}
      </div>
      <div className="grow" />
      <CusoStatus
        overview={overview}
        now={now}
        onOpen={() => onSelect("today")}
      />
      {/* The person is the account menu's button, so the name has the row. */}
      <AccountMenu
        label="Account"
        signOut={signOut}
        cusoPicker={false}
        trigger={
          <>
            <span className="avatar" aria-hidden="true">
              {initial(name || email)}
            </span>
            <span className="who-text">
              <span className="who-name">{name || email}</span>
              {name ? <span className="note">{email}</span> : null}
            </span>
          </>
        }
      />
    </nav>
  );
}
