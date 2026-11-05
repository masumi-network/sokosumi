"use client";

import "../../components/onboarding/onboarding.css";

import { Brain, CalendarDays, MessageSquare, Target } from "lucide-react";

import { CusoStatus } from "../../components/app/cuso-status";
import {
  AssumptionChip,
  Checklist,
  CusoAvatar,
  GoalBlock,
  QuestionCard,
  SidePanel,
  SkeletonTile,
  StatRow,
  StepMarkers,
  Tile,
} from "../../components/onboarding/parts";
import { overview } from "./app/fixtures";

const noop = async () => {};

const NAV = [
  { Icon: MessageSquare, label: "Cuso" },
  { Icon: Target, label: "Strategy", active: true },
  { Icon: CalendarDays, label: "Calendar", count: 11 },
  { Icon: Brain, label: "Brand Brain" },
];

const AT = new Date("2026-11-05T08:00:00Z");

/** Cuso's status card in each pose, over the app fixture. */
const STATUS_CARDS = [
  { label: "Reading", overview: { ...overview, learning: "running" as const } },
  { label: "Thinking", overview },
  {
    label: "Needs you",
    overview: { ...overview, brandBrain: null, strategy: null },
  },
  {
    label: "Reporting",
    overview: {
      ...overview,
      production: { ...overview.production, state: "ready" as const },
    },
  },
  {
    label: "Done",
    overview: {
      ...overview,
      production: { ...overview.production, state: "ready" as const },
      updates: [],
    },
  },
];

/**
 * The composite parts the onboarding screens are built from, with small
 * static props. A client component, since the parts take handlers.
 */
export function PartsPreview() {
  return (
    <div className="ds-parts">
      <div className="ds-part">
        <p className="ds-t-small ds-muted">Step markers</p>
        <StepMarkers current={1} reached={1} />
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">Checklist and skeleton tile</p>
        <Checklist
          items={[
            { label: "Your website", state: "done" },
            { label: "Your market and competitors", state: "working" },
            { label: "Your Brand Brain", state: "next" },
          ]}
        />
        <SkeletonTile />
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">Question card</p>
        <QuestionCard
          topic="Target customers"
          question={{ question: "Are households your largest customer group?" }}
          index={1}
          answered={[true, false, false]}
          onAnswer={noop}
          onSkip={() => {}}
        />
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">Tile, closed and open</p>
        <div className="ds-tiles">
          <Tile
            label="What you sell"
            value="Rocket Pro"
            detail="$99 a month. A rocket for teams."
            source="Source: acme.io/pricing"
          />
          <Tile
            label="Who buys"
            value="Head of product"
            detail="Wants: launches that land on the day"
            source="Source: acme.io"
            open
          />
        </div>
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">Side panel</p>
        <SidePanel title="Who buys" onClose={() => {}} source="Source: acme.io">
          <p>Teams of ten to fifty who ship a product every month.</p>
        </SidePanel>
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">Assumption chip</p>
        <AssumptionChip
          question="Is €200 a month OK for ads?"
          yes={{ onClick: () => {} }}
          other={{ label: "Change", onClick: () => {} }}
        />
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">Goal block</p>
        <GoalBlock
          label="The goal"
          goal="More demo requests"
          facts={[
            { term: "Who", value: "Product teams" },
            { term: "The offer", value: "A 14-day trial" },
            { term: "Where", value: "LinkedIn, X" },
            { term: "This month", value: "28 pieces" },
          ]}
        />
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">Stat row</p>
        <StatRow
          stats={[
            { value: "3 min", line: "I read your site." },
            { value: "5 taps", line: "You answer a few questions." },
            { value: "1 plan", line: "You approve it." },
          ]}
        />
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">
          Sidebar: workspace card, current row, ink count badge, Cuso status
        </p>
        <nav className="side ds-side" aria-label="Sidebar preview">
          <div className="business">
            <span className="business-text">
              <span className="business-name">Acme</span>
              <span className="note">acme.io</span>
            </span>
          </div>
          <div className="nav">
            {NAV.map(({ Icon, label, active, count }) => (
              <a
                key={label}
                href="#sidebar"
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
                {count ? <span className="count num">{count}</span> : null}
              </a>
            ))}
          </div>
          <CusoStatus overview={overview} now={AT} />
        </nav>
        <p className="ds-t-small ds-muted">Cuso status, by pose</p>
        <div className="ds-statuses">
          {STATUS_CARDS.map((card) => (
            <CusoStatus key={card.label} overview={card.overview} now={AT} />
          ))}
        </div>
      </div>

      <div className="ds-part">
        <p className="ds-t-small ds-muted">Cuso avatar sizes</p>
        <div className="ds-avatars">
          <CusoAvatar pose="thinking" size={36} />
          <CusoAvatar pose="reporting" size={48} />
          <CusoAvatar pose="done" size={96} />
        </div>
      </div>
    </div>
  );
}
