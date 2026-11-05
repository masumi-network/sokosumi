"use client";

import "./onboarding/onboarding.css";

import { ArrowRight, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { OnboardFormState } from "../app/cmo-actions";
import { useFocusFirstInvalid } from "./form-field";
import { Logo } from "./logo";
import {
  AGENT_NAME,
  CusoAvatar,
  StatRow,
  StepMarkers,
} from "./onboarding/parts";

const STATS = [
  { value: "3 min", line: "I read your site and what is public about you." },
  { value: "5 taps", line: "You answer quick questions while I read." },
  { value: "1 plan", line: "You approve it. Nothing posts before that." },
];

interface OnboardingProps {
  /** The website a CMO sign-up link carried, to start the field with. */
  websiteUrl?: string | undefined;
  onboard: (
    previous: OnboardFormState,
    formData: FormData,
  ) => Promise<OnboardFormState>;
}

/**
 * Hiring Cuso, step one: the website. An error sits by it and what was
 * typed stays.
 */
export function Onboarding({ websiteUrl, onboard }: OnboardingProps) {
  const [state, formAction] = useActionState(onboard, {
    attempt: 0,
    websiteUrl: websiteUrl ?? "",
    errors: {},
  });
  const { errors } = state;
  const formRef = useFocusFirstInvalid(state.attempt);
  const websiteErrorId = errors.websiteUrl ? "ob-website-error" : undefined;

  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
        <StepMarkers current={0} reached={0} />
        <span />
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
              <CusoAvatar pose="needs-you" size={48} />
              <p className="ob-muted">
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
                <span className="ob-small ob-muted">
                  A shop, a SaaS, a portfolio. Any public site works.
                </span>
              )}
            </div>
            <StatRow stats={STATS} />
          </form>
          <div className="panel ob-hire-stage">
            <div className="ob-stage">
              <img
                className="ob-stage-art"
                src="/cuso/hero.jpg"
                alt={`${AGENT_NAME} walking with a megaphone`}
                width={640}
                height={800}
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
