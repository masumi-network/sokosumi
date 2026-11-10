"use client";

import "./onboarding/onboarding.css";

import { ChevronDown, LogOut, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AGENT_NAME } from "../lib/agent";
import { StartOver } from "./start-over";
import { ThemeToggle } from "./theme-toggle";

interface AccountMenuProps {
  label: string;
  startOver?: () => Promise<string | null>;
  signOut?: (() => Promise<void>) | undefined;
}

/**
 * Who is signed in, the Cuso picker and the way out; closes on a click
 * outside or Escape.
 */
export function AccountMenu({ label, startOver, signOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        root.current?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
      if (event instanceof KeyboardEvent) trigger.current?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="ob-who" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="ob-who-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dot live" aria-hidden="true" />
        <span className="ob-who-name">{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ob-who-menu">
          <ThemeToggle className="ob-who-item" withLabel />
          <a className="ob-who-item" href="/?cusos=1">
            <Users size={14} aria-hidden="true" />
            Your {AGENT_NAME}s
          </a>
          {startOver ? (
            <StartOver className="ob-who-item" startOver={startOver} />
          ) : null}
          {signOut ? (
            <form action={signOut}>
              <button type="submit" className="ob-who-item">
                <LogOut size={14} aria-hidden="true" />
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
