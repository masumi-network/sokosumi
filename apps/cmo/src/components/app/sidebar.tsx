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
  Users,
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

/** The app's sidebar: the Business, pages, the Cuso picker, Cuso's status and the person. */
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
  const host = hostOf(overview.websiteUrl);
  const displayName = businessDisplayName(overview);
  const needs = needsYou(overview).length;
  return (
    <nav className="side" aria-label="Main">
      <div className="business card" title={overview.websiteUrl}>
        <BusinessMark overview={overview} size={28} />
        <span className="business-text">
          <span className="business-name">{displayName}</span>
          {host !== displayName ? <span className="note">{host}</span> : null}
        </span>
      </div>
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
        {/* The Cuso picker: switch Business or hire another (ADR 0065). */}
        {manyCusos ? (
          <a href="/?cusos=1">
            <Users size={16} aria-hidden="true" />
            <span>Your {AGENT_NAME}s</span>
          </a>
        ) : null}
      </div>
      <div className="grow" />
      <CusoStatus
        overview={overview}
        now={now}
        onOpen={() => onSelect("chat")}
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
