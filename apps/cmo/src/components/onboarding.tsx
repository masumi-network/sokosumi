"use client";

import "./onboarding/onboarding.css";

import { ArrowRight, Loader2 } from "lucide-react";
import { useActionState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

import type { OnboardFormState } from "../app/cmo-actions";
import { useFocusFirstInvalid } from "../hooks/effects/use-focus-first-invalid";
import { AGENT_NAME } from "../lib/agent";
import { track } from "../lib/analytics";
import { AccountMenu } from "./account-menu";
import { cusoArt } from "./cuso";
import { Logo } from "./logo";
import { StepMarkers } from "./onboarding/step-markers";

const subscribeNoop = () => () => {};
const getBrowserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
const getServerTimeZone = () => "";

interface OnboardingProps {
  /** The website a CMO sign-up link carried, to start the field with. */
  websiteUrl?: string | undefined;
  /** The person's organizations, which Cuso may go into instead of a new one. */
  organizations?: { id: string; name: string }[];
  signOut?: () => Promise<void>;
  /** False without a Cuso: the picker would only reload this form. */
  cusoPicker?: boolean;
  /** Hire a test copy of this Project's Cuso, in his organization. */
  testCopyOf?: string | undefined;
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
  cusoPicker,
  testCopyOf,
  onboard,
}: OnboardingProps) {
  const [state, formAction] = useActionState(onboard, {
    attempt: 0,
    websiteUrl: websiteUrl ?? "",
    errors: {},
  });
  const { errors } = state;
  const formRef = useFocusFirstInvalid(state.attempt);
  // The owner's time zone, so Cuso's routines run at their local times. Read
  // after mount: the server does not know it.
  const timeZone = useSyncExternalStore(
    subscribeNoop,
    getBrowserTimeZone,
    getServerTimeZone,
  );
  const websiteErrorId = errors.websiteUrl ? "ob-website-error" : undefined;
  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
        <StepMarkers current={0} reached={0} />
        {signOut ? (
          <AccountMenu
            label="Account"
            signOut={signOut}
            cusoPicker={cusoPicker}
          />
        ) : (
          <span />
        )}
      </header>
      <main className="ob-main">
        {/* Remounts after each submit (useFocusFirstInvalid). */}
        <form
          key={state.attempt}
          ref={formRef}
          action={formAction}
          onSubmit={() => track("website_entered")}
          className="ob-hire"
        >
          <input type="hidden" name="timeZone" value={timeZone} />
          {testCopyOf ? (
            <input type="hidden" name="testCopyOf" value={testCopyOf} />
          ) : null}
          <div className="ob-stage">
            <img
              className="ob-stage-art"
              src={cusoArt("walking")}
              alt={`${AGENT_NAME} walking`}
              width={640}
              height={640}
            />
            <span className="ob-tilt ob-tilt-a">Reads your site</span>
            <span className="ob-tilt ob-tilt-b">Spots your competitors</span>
            <span className="ob-tilt ob-tilt-c ob-tilt-ink">
              Drafts your first month
            </span>
          </div>
          <h1 className="ob-display">
            Give me your website. I'll show you a month of posts.
          </h1>
          <p className="muted">
            {AGENT_NAME} is your AI CMO. He reads your site, plans your month
            and runs it.
          </p>
          {testCopyOf ? (
            <p className="muted">
              Test copy. He uses the accounts of the {AGENT_NAME} he copies, and
              nothing he makes goes out.
            </p>
          ) : null}
          {errors.form ? (
            <p className="alert" role="alert" tabIndex={-1}>
              {errors.form}
              {state.unpaidCuso ? (
                <>
                  {" "}
                  <a className="ob-link" href={state.unpaidCuso.href}>
                    Open {state.unpaidCuso.businessName}
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
          {organizations.length > 0 && !testCopyOf ? (
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
        </form>
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
