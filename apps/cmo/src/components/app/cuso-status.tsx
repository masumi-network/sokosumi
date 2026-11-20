import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight } from "lucide-react";
import Image from "next/image";

import { AGENT_NAME } from "../../lib/agent";
import { dayName, nextWeeklyReview } from "../../lib/page-lead";
import { type CusoPose, cusoPose, cusoStatus } from "../../lib/thread";
import { needsYou } from "../../lib/today";
import type { View } from "../../lib/views";
import { type CusoArt, cusoArt } from "../cuso";

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
}

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
          ? `${production.ready} of ${production.total} made`
          : cusoStatus(overview);
  return { pose, art: ART[pose], line, needs };
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
  const busy =
    mood.pose === "reading" ||
    mood.pose === "thinking" ||
    overview.production.state === "running";
  if (mood.needs > 0 || busy) return mood;
  return { ...mood, line: pageLine(view, overview, now) ?? mood.line };
}

interface CusoStatusProps {
  overview: CmoOverview;
  /** The page the owner is on: his bubble speaks about it. */
  view: View;
  /** The time "just filed" counts from; tests and the preview pin it. */
  now?: Date;
  /** Opens Today, where everything that needs the owner is. */
  onOpen: () => void;
}

/**
 * Cuso at the foot of the sidebar on every page: large, on an Iris stage,
 * standing on his light ground and leaning out over the sidebar's edge into
 * the page's gutter. His bubble says what he is doing and opens Today. The
 * drawing never takes a press; the words carry the state.
 */
export function CusoStatus({
  overview,
  view,
  now = new Date(),
  onOpen,
}: CusoStatusProps) {
  const { pose, art, line } = cusoBubble(overview, view, now);
  const working = pose === "reading" || pose === "thinking";
  const words = (
    <>
      {working ? <span className="ob-box-dot" aria-hidden="true" /> : null}
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
        <button
          type="button"
          className="cuso-says"
          aria-label={`${AGENT_NAME}: ${line}. Open Today`}
          onClick={onOpen}
        >
          {words}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
      <span className="cuso-figure" aria-hidden="true">
        <span className="cuso-ground" />
        <Image
          key={art}
          src={cusoArt(art)}
          alt=""
          width={624}
          height={652}
          // He is the page's largest picture on a wide screen; a phone hides
          // the sidebar and takes the smallest file.
          sizes="(max-width: 860px) 16px, 360px"
          preload
        />
      </span>
    </div>
  );
}
