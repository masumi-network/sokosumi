"use client";

import "./onboarding/onboarding.css";

import { ArrowRight, Loader2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import type { OnboardFormState } from "../app/cmo-actions";
import { AGENT_NAME } from "../lib/agent";
import { AccountMenu } from "./account-menu";
import { CusoAvatar } from "./cuso";
import { CusoClip } from "./cuso-clip";
import { useFocusFirstInvalid } from "./form-field";
import { Logo } from "./logo";
import { StepMarkers } from "./onboarding/step-markers";
import { StatRow } from "./onboarding/tiles";

const STATS = [
  { value: "3 min", line: "I read your site and what is public about you." },
  { value: "5 taps", line: "You answer quick questions while I read." },
  { value: "1 plan", line: "You approve it. Nothing posts before that." },
];

/** hero.jpg's size, and its megaphone's mouth while Cuso shouts (as shares). */
const HERO = { width: 800, height: 1200 };
const MEGAPHONE = { x: 0.68, y: 0.45 };

/**
 * Starts each stage label at the megaphone, so it flies out of it. The stage
 * draws the hero with object-fit cover from the bottom centre (onboarding.css).
 */
function aimLabels(stage: HTMLElement) {
  const box = stage.getBoundingClientRect();
  const scale = Math.max(box.width / HERO.width, box.height / HERO.height);
  const mouthX =
    box.left +
    (box.width - HERO.width * scale) / 2 +
    MEGAPHONE.x * HERO.width * scale;
  const mouthY = box.bottom - (1 - MEGAPHONE.y) * HERO.height * scale;
  for (const label of stage.querySelectorAll<HTMLElement>(".ob-tilt")) {
    // Still at scale 0, the label's box is its centre.
    const at = label.getBoundingClientRect();
    label.style.setProperty(
      "--from-x",
      `${mouthX - (at.left + at.width / 2)}px`,
    );
    label.style.setProperty(
      "--from-y",
      `${mouthY - (at.top + at.height / 2)}px`,
    );
  }
}

interface OnboardingProps {
  /** The website a CMO sign-up link carried, to start the field with. */
  websiteUrl?: string | undefined;
  /** The person's organizations, which Cuso may go into instead of a new one. */
  organizations?: { id: string; name: string }[];
  signOut?: () => Promise<void>;
  onboard: (
    previous: OnboardFormState,
    formData: FormData,
  ) => Promise<OnboardFormState>;
}

/**
 * Hiring Cuso, step one: the website, then where he goes when the person
 * belongs to an organization (ADR 0065). An error sits by it and what was
 * typed stays.
 */
export function Onboarding({
  websiteUrl,
  organizations = [],
  signOut,
  onboard,
}: OnboardingProps) {
  const [state, formAction] = useActionState(onboard, {
    attempt: 0,
    websiteUrl: websiteUrl ?? "",
    errors: {},
  });
  const { errors } = state;
  const formRef = useFocusFirstInvalid(state.attempt);
  const websiteErrorId = errors.websiteUrl ? "ob-website-error" : undefined;
  // The hero plays first: Cuso announces the labels, and the avatar by the
  // intro answers once it ends.
  const stage = useRef<HTMLDivElement>(null);
  const [announcing, setAnnouncing] = useState(false);
  const [heroPlayed, setHeroPlayed] = useState(false);

  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
        <StepMarkers current={0} reached={0} />
        {signOut ? <AccountMenu label="Account" signOut={signOut} /> : <span />}
      </header>
      <main className="ob-main">
        <div className="ob-hire">
          {/* Remounts after each submit (useFocusFirstInvalid). */}
          <form
            key={state.attempt}
            ref={formRef}
            action={formAction}
            className="ob-hire-copy"
          >
            <div className="ob-intro">
              <CusoAvatar pose="needs-you" size={48} play={heroPlayed} />
              <p className="muted">
                {AGENT_NAME} is your AI CMO. He reads your site, plans your
                month and runs it.
              </p>
            </div>
            <h1 className="ob-display">
              Give me your website. I'll bring back a plan.
            </h1>
            {errors.form ? (
              <p className="alert" role="alert" tabIndex={-1}>
                {errors.form}
                {state.topUpUrl ? (
                  <>
                    {" "}
                    <a
                      className="ob-link"
                      href={state.topUpUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Top up
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="ob-website">Your website</label>
              <div className="ob-hire-row">
                <input
                  id="ob-website"
                  name="websiteUrl"
                  required
                  placeholder="yourbusiness.com"
                  autoComplete="url"
                  inputMode="url"
                  defaultValue={state.websiteUrl}
                  aria-invalid={errors.websiteUrl ? true : undefined}
                  aria-describedby={websiteErrorId}
                />
                <StartButton />
              </div>
              {errors.websiteUrl ? (
                <p id={websiteErrorId} className="alert" role="alert">
                  {errors.websiteUrl}
                </p>
              ) : (
                <span className="ob-small muted">
                  A shop, a SaaS, a portfolio. Any public site works.
                </span>
              )}
            </div>
            {organizations.length > 0 ? (
              <fieldset className="ob-where">
                <legend>Where</legend>
                {[
                  {
                    id: "",
                    name: "New organization (named after your website)",
                  },
                  ...organizations,
                ].map((organization) => (
                  <label key={organization.id}>
                    <input
                      type="radio"
                      name="organizationId"
                      value={organization.id}
                      defaultChecked={
                        organization.id === (state.organizationId ?? "")
                      }
                    />
                    {organization.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <StatRow stats={STATS} />
          </form>
          <div className="panel ob-hire-stage">
            <div
              ref={stage}
              className={announcing ? "ob-stage ob-stage-live" : "ob-stage"}
            >
              <CusoClip
                className="ob-stage-art"
                src="/cuso/hero.jpg"
                alt={`${AGENT_NAME} walking with a megaphone`}
                width={640}
                height={800}
                onStart={() => {
                  if (stage.current) aimLabels(stage.current);
                  setAnnouncing(true);
                }}
                onEnded={() => setHeroPlayed(true)}
              />
              <span className="ob-tilt ob-tilt-a">Reads your site</span>
              <span className="ob-tilt ob-tilt-b">Spots your competitors</span>
              <span className="ob-tilt ob-tilt-c ob-tilt-ink">
                Drafts your first month
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StartButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button" disabled={pending}>
      {pending ? (
        <Loader2 size={16} className="spin" aria-hidden="true" />
      ) : null}
      {pending ? "Starting" : "Start reading"}
      {pending ? null : <ArrowRight size={16} aria-hidden="true" />}
    </button>
  );
}
