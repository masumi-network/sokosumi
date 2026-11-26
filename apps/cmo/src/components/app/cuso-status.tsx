"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { useRef, useState } from "react";
import { useCusoRig } from "../../hooks/effects/use-cuso-rig";
import { useMediaQuery } from "../../hooks/effects/use-media-query";
import { useTimeout } from "../../hooks/effects/use-timeout";

import { AGENT_NAME } from "../../lib/agent";
import { dayName, nextWeeklyReview } from "../../lib/page-lead";
import { type CusoPose, cusoPose, cusoStatus } from "../../lib/thread";
import { monthMade, needsYou } from "../../lib/today";
import type { View } from "../../lib/views";
import { type CusoArt, cusoArt } from "../cuso";
import { ViewLink } from "./view-link";

/** The drawing each state shows: he points at the owner when needed. */
const ART: Record<CusoPose, CusoArt> = {
  reading: "researching",
  thinking: "thinking",
  reporting: "friendly",
  done: "correct",
  "needs-you": "pointing",
};

interface Mood {
  pose: CusoPose;
  art: CusoArt;
  line: string;
  needs: number;
  /** He is at work: reading, thinking or making the month. */
  busy: boolean;
  /** The month stopped or could not start: no page line hides it. */
  alarm: boolean;
}

/** "148 of 169 made": the month's posts, as Today and the Calendar count them. */
function madeLine(overview: CmoOverview): string {
  const { ready, total } = monthMade(overview);
  return `${ready} of ${total} made`;
}

/** "Stopped at 67 of 171": the month stopped with posts missing. */
function stoppedLine(overview: CmoOverview): string {
  const { ready, total } = monthMade(overview);
  return `Stopped at ${ready} of ${total}`;
}

/** Pages where he is looking things up while nothing else is going on. */
const LOOKING: ReadonlySet<View> = new Set(["seo", "competitors"]);

/** Cuso's state: his pose and the one line he says about it. */
export function cusoMood(overview: CmoOverview, now: Date = new Date()): Mood {
  const needs = needsYou(overview).length;
  const pose = needs > 0 ? "needs-you" : cusoPose(overview, now);
  const { production } = overview;
  const line =
    needs === 1
      ? "One thing needs you"
      : needs > 1
        ? `${needs} things need you`
        : production.state === "planning"
          ? "Planning your month"
          : production.state === "running" || production.state === "starting"
            ? madeLine(overview)
            : production.state === "stuck"
              ? stoppedLine(overview)
              : cusoStatus(overview);
  const busy =
    pose === "reading" ||
    pose === "thinking" ||
    production.state === "running" ||
    production.state === "planning";
  // A month that stopped or could not start is said on every page.
  const alarm = production.state === "stuck" || production.state === "blocked";
  return { pose, art: ART[pose], line, needs, busy, alarm };
}

/** What he says about the page the owner is on, while nothing needs them. */
function pageLine(view: View, overview: CmoOverview, now: Date): string | null {
  switch (view) {
    case "chat":
      return "I'm listening";
    case "calendar": {
      const scheduled = overview.posts.scheduled;
      return scheduled > 0
        ? `${scheduled === 1 ? "1 post is" : `${scheduled} posts are`} scheduled`
        : null;
    }
    case "results": {
      const review = nextWeeklyReview(overview);
      return review
        ? `Next numbers ${dayName(review.at, review.zone ?? overview.timeZone, now)}`
        : null;
    }
    case "strategy":
      return overview.strategy ? "This is how we win" : null;
    case "brain":
      return overview.brandBrain ? "Tell me if I got you wrong" : null;
    case "competitors":
      return "I check them every week";
    case "seo":
      return "I check your site every week";
    case "settings":
      return "All set up";
    default:
      return null;
  }
}

/**
 * What the sidebar's Cuso shows on a page: pointing at whatever needs the
 * owner, at work while he works, else a word about the page they are on.
 */
export function cusoBubble(
  overview: CmoOverview,
  view: View,
  now: Date = new Date(),
): Mood {
  const mood = cusoMood(overview, now);
  if (mood.needs > 0 || mood.busy || mood.alarm) return mood;
  return {
    ...mood,
    art: LOOKING.has(view) ? "researching" : mood.art,
    line: pageLine(view, overview, now) ?? mood.line,
  };
}

/** How long a passing pose holds before he settles back. */
export const MOMENT_MS = { walking: 1200, correct: 2600 } as const;

/**
 * A passing pose on top of his state: he walks for a moment when the owner
 * opens another page, and shows his check mark when his work just finished.
 * Without motion he keeps the pose of his state.
 */
export function useCusoMoment(
  art: CusoArt,
  view: View,
  busy: boolean,
): { art: CusoArt; moving: boolean } {
  const still = useMediaQuery("(prefers-reduced-motion: reduce)", true);
  const [seen, setSeen] = useState({ view, busy });
  const [moment, setMoment] = useState<keyof typeof MOMENT_MS | null>(null);
  if (seen.view !== view || seen.busy !== busy) {
    setSeen({ view, busy });
    if (seen.view !== view) setMoment("walking");
    else if (seen.busy && !busy) setMoment("correct");
  }
  useTimeout(
    () => setMoment(null),
    moment ? MOMENT_MS[moment] : null,
    `${moment}:${view}`,
  );
  return still || !moment
    ? { art, moving: false }
    : { art: moment, moving: true };
}

interface CusoStatusProps {
  overview: CmoOverview;
  /** The page the owner is on: his pill speaks about it. */
  view: View;
  /** The time "just filed" counts from; tests and the preview pin it. */
  now?: Date;
  /** Opens Today, where everything that needs the owner is. */
  onOpen: (view: View) => void;
}

/**
 * Cuso at the foot of the sidebar on every page: large, on an Iris stage, in
 * a spotlight. His pill says what he is doing and links to Today. He is
 * animated (`cuso-rig.ts`) once his poses load; until then, or with motion
 * off, he is the still of his pose. The drawing never takes a press; the
 * words carry the state.
 */
export function CusoStatus({
  overview,
  view,
  now = new Date(),
  onOpen,
}: CusoStatusProps) {
  const mood = cusoBubble(overview, view, now);
  const { pose, line } = mood;
  const { art, moving } = useCusoMoment(mood.art, view, mood.busy);
  const host = useRef<HTMLSpanElement>(null);
  const still = useMediaQuery("(prefers-reduced-motion: reduce)", true);
  // A phone hides the sidebar: no rig, no drawing to load.
  const wide = useMediaQuery("(min-width: 861px)", false);
  const { live, hop } = useCusoRig(host, art, wide && !still);
  const working = pose === "reading" || pose === "thinking";
  const words = (
    <>
      <span
        className={working ? "ob-box-dot" : "cuso-dot"}
        aria-hidden="true"
      />
      {line}
    </>
  );
  return (
    // A pointer coming onto his stage makes him hop.
    <div className="cuso-status" data-pose={pose} onPointerEnter={hop}>
      {view === "today" ? (
        <p className="cuso-says" role="status">
          <span className="sr-only">{AGENT_NAME}: </span>
          {words}
        </p>
      ) : (
        <ViewLink
          view="today"
          open={onOpen}
          className="cuso-says"
          aria-label={`${AGENT_NAME}: ${line}. Open Today`}
        >
          {words}
        </ViewLink>
      )}
      <span
        className="cuso-figure"
        aria-hidden="true"
        data-moving={moving ? "" : undefined}
        data-live={live ? "" : undefined}
      >
        <span className="cuso-ground" />
        {/* The rig adds his animated drawing here; React keeps these two. */}
        <span className="cuso-poses" data-art={art} ref={host}>
          <span className="cuso-shadow" />
          <img className="cuso-still" src={cusoArt(art)} alt="" />
        </span>
      </span>
    </div>
  );
}
