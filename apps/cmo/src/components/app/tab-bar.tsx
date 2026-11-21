"use client";

import { LogOut, Menu, Users } from "lucide-react";
import { useRef, useState } from "react";
import { useEventListener } from "../../hooks/effects/use-event-listener";
import { AGENT_NAME } from "../../lib/agent";
import type { View } from "../../lib/views";
import { type CusoArt, cusoArt } from "../cuso";
import { ThemeToggle } from "../theme-toggle";
import { VIEWS } from "./sidebar";
import { ViewLink } from "./view-link";

/** The four places an owner goes most; the rest sit under More. */
const TABS: readonly View[] = ["today", "chat", "calendar", "results"];

interface TabBarProps {
  view: View;
  onSelect: (view: View) => void;
  /** What needs the owner, counted on Today. */
  needs: number;
  /** Cuso's pose for his state: on a phone he stands in his own tab. */
  pose: CusoArt;
  manyCusos?: boolean;
  signOut?: () => Promise<void>;
}

/**
 * The phone's navigation: a bar at the bottom within the thumb's reach,
 * Today, Cuso, Calendar and Results, and More for every other page.
 */
export function TabBar({
  view,
  onSelect,
  needs,
  pose,
  manyCusos = false,
  signOut,
}: TabBarProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const more = useRef<HTMLButtonElement>(null);

  useEventListener(open ? "document" : null, "pointerdown", (event) => {
    if (root.current?.contains(event.target as Node)) return;
    setOpen(false);
  });
  useEventListener(open ? "document" : null, "keydown", (event) => {
    if (event.key !== "Escape") return;
    more.current?.focus();
    setOpen(false);
  });

  const pick = (next: View) => {
    setOpen(false);
    onSelect(next);
  };
  const inMore = !TABS.includes(view);
  return (
    <nav className="tabbar" aria-label="Main" ref={root}>
      {open ? (
        <div className="tabbar-more" id="tabbar-more">
          {VIEWS.filter(([id]) => !TABS.includes(id)).map(
            ([id, label, Icon]) => (
              <ViewLink
                key={id}
                view={id}
                open={pick}
                className={view === id ? "active" : ""}
                aria-current={view === id ? "page" : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </ViewLink>
            ),
          )}
          {manyCusos ? (
            <a href="/?cusos=1">
              <Users size={16} aria-hidden="true" />
              Your {AGENT_NAME}s
            </a>
          ) : null}
          <ThemeToggle className="tabbar-more-item" withLabel />
          {signOut ? (
            <form action={signOut}>
              <button type="submit" className="tabbar-more-item">
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {VIEWS.filter(([id]) => TABS.includes(id)).map(([id, label, Icon]) => (
        <ViewLink
          key={id}
          view={id}
          open={pick}
          className={view === id ? "tab active" : "tab"}
          aria-current={view === id ? "page" : undefined}
        >
          <span className="tab-icon">
            {id === "chat" ? (
              <img className="tab-cuso" src={cusoArt(pose)} alt="" />
            ) : (
              <Icon size={20} aria-hidden="true" />
            )}
            {id === "today" && needs > 0 ? (
              <span className="count num" aria-label={`${needs} need you`}>
                {needs}
              </span>
            ) : null}
          </span>
          {label}
        </ViewLink>
      ))}
      <button
        ref={more}
        type="button"
        className={inMore ? "tab active" : "tab"}
        aria-expanded={open}
        aria-controls="tabbar-more"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tab-icon">
          <Menu size={20} aria-hidden="true" />
        </span>
        More
      </button>
    </nav>
  );
}
