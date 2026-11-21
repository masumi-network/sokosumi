"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import Image from "next/image";
import { useState } from "react";
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
  reading: "searching",
  thinking: "thinking",
  reporting: "walking",
  done: "thumbs-up",
  "needs-you": "pointing",
};

interface Mood {
  pose: CusoPose;
  art: CusoArt;
  line: string;
  needs: number;
  /** He is at work: reading, thinking or making the month. */
  busy: boolean;
}

/** Every drawing he has, with its size, kept on the stage so a change never loads one. */
const POSES: readonly (readonly [CusoArt, number, number])[] = [
  ["pointing", 624, 652],
  ["thinking", 495, 657],
  ["searching", 601, 641],
  ["walking", 627, 649],
  ["thumbs-up", 592, 661],
];

/** "148 of 169 made": the month's posts, as Today and the Calendar count them. */
function madeLine(overview: CmoOverview): string {
  const { ready, total } = monthMade(overview);
  return `${ready} of ${total} made`;
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
        : production.state === "running"
          ? madeLine(overview)
          : cusoStatus(overview);
  const busy =
    pose === "reading" || pose === "thinking" || production.state === "running";
  return { pose, art: ART[pose], line, needs, busy };
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
  if (mood.needs > 0 || mood.busy) return mood;
  return {
    ...mood,
    art: LOOKING.has(view) ? "searching" : mood.art,
    line: pageLine(view, overview, now) ?? mood.line,
  };
}

/** How long a passing pose holds before he settles back. */
export const MOMENT_MS = { walking: 1200, "thumbs-up": 2600 } as const;

/**
 * A passing pose on top of his state: he walks for a moment when the owner
 * opens another page, and gives a thumbs-up when his work just finished.
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
    else if (seen.busy && !busy) setMoment("thumbs-up");
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
 * a light porthole, his arm out over its rim and the sidebar's edge into the
 * page's gutter. His pill says what he is doing and links to Today. The
 * drawing never takes a press; the words carry the state.
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
    <div className="cuso-status" data-pose={pose}>
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
      >
        <span className="cuso-ground" />
        {/* Every pose stays mounted; the one shown fades in over the last. */}
        <span className="cuso-poses" data-art={art}>
          {POSES.map(([pose, width, height]) => (
            <Image
              key={pose}
              className={`cuso-pose cuso-pose-${pose}`}
              data-on={pose === art ? "" : undefined}
              src={cusoArt(pose)}
              alt=""
              width={width}
              height={height}
              // He is the page's largest picture on a wide screen; a phone
              // hides the sidebar and takes the smallest file.
              sizes="(max-width: 860px) 16px, 240px"
              loading="eager"
              preload={pose === art}
            />
          ))}
        </span>
      </span>
    </div>
  );
}
