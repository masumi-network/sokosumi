"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  Brain,
  CalendarDays,
  ChartLine,
  type LucideIcon,
  MessageSquare,
  Settings,
  Share2,
  Target,
  Users,
} from "lucide-react";
import { AGENT_NAME } from "../../lib/agent";
import { VIEW_PATHS, type View } from "../../lib/views";
import { hostOf } from "../brand-profile";
import { BusinessMark, businessDisplayName } from "../business-mark";
import { Logo } from "../logo";
import { ThemeToggle } from "../theme-toggle";
import { CusoStatus } from "./cuso-status";

export const VIEWS = [
  ["chat", AGENT_NAME, MessageSquare],
  ["strategy", "Strategy", Target],
  ["calendar", "Calendar", CalendarDays],
  ["results", "Results", ChartLine],
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
  now,
}: SidebarProps) {
  const host = hostOf(overview.websiteUrl);
  const displayName = businessDisplayName(overview);
  return (
    <nav className="side" aria-label="Main">
      <div className="side-head">
        <Logo />
      </div>
      <div className="business card" title={overview.websiteUrl}>
        <BusinessMark overview={overview} size={28} />
        <span className="business-text">
          <span className="business-name">{displayName}</span>
          {host !== displayName ? <span className="note">{host}</span> : null}
        </span>
      </div>
      <div className="nav">
        {VIEWS.map(([id, label, Icon]) => (
          <a
            key={id}
            href={VIEW_PATHS[id]}
            className={view === id ? "active" : ""}
            aria-current={view === id ? "page" : undefined}
            onClick={(event) => {
              // A modified click opens the page in a new tab as usual.
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              onSelect(id);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
        {/* The Cuso picker: switch Business or hire another (ADR 0065). */}
        <a href="/?cusos=1">
          <Users size={16} aria-hidden="true" />
          <span>Your {AGENT_NAME}s</span>
        </a>
      </div>
      <div className="grow" />
      <CusoStatus
        overview={overview}
        now={now}
        onOpen={() => onSelect("chat")}
      />
      <div className="who">
        <span className="avatar" aria-hidden="true">
          {initial(name || email)}
        </span>
        <span className="who-text">
          <span className="who-name">{name || email}</span>
          {name ? <span className="note">{email}</span> : null}
        </span>
        <ThemeToggle className="who-theme" />
      </div>
    </nav>
  );
}
