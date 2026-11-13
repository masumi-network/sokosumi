"use client";

import "./onboarding/onboarding.css";
import "./onboarding/brief.css";

import { ArrowRight, Loader2 } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import type { OnboardFormState } from "../app/cmo-actions";
import { AGENT_NAME } from "../lib/agent";
import { SIGN_UP_CONTEXT_FIELD } from "../lib/kept-website";
import { AccountMenu } from "./account-menu";
import { useFocusFirstInvalid } from "./form-field";
import { Logo } from "./logo";
import { websiteMarks } from "./onboarding/brief";
import { BriefBar, StageBar } from "./onboarding/brief-bar";

interface OnboardingProps {
  /** The website typed before sign in, or a CMO sign-up link carried. */
  websiteUrl?: string | undefined;
  /** Reading starts on its own: the website was typed before sign in. */
  autoStart?: boolean;
  /** Before sign in: Continue goes to Create account, keeping the website. */
  signedOut?: boolean;
  /** Before sign in: a Create account link's parameters, sent with the website. */
  signUpContext?: Record<string, string>;
  /** The person's organizations, which Cuso may go into instead of a new one. */
  organizations?: { id: string; name: string }[];
  signOut?: () => Promise<void>;
  /** False without a Cuso: the picker would only reload this form. */
  cusoPicker?: boolean;
  onboard: (
    previous: OnboardFormState,
    formData: FormData,
  ) => Promise<OnboardFormState>;
}

/**
/**
 * Hiring Cuso, stage one: the website, before sign in too, then where he goes
 * when the person belongs to an organization (ADR 0065). The page shows what
 * happens next; the bar asks. An error sits by the field and what was typed
 * stays.
 */
export function Onboarding({
  websiteUrl,
  autoStart = false,
  signedOut = false,
  signUpContext = {},
  organizations = [],
  signOut,
  cusoPicker,
  onboard,
}: OnboardingProps) {
  const [state, formAction, starting] = useActionState(onboard, {
    attempt: 0,
    websiteUrl: websiteUrl ?? "",
    errors: {},
  });
  const { errors } = state;
  const formRef = useFocusFirstInvalid(state.attempt);
  const websiteErrorId = errors.websiteUrl ? "ob-website-error" : undefined;
  // Once, even when Strict Mode runs effects twice: each start is a hire.
  const started = useRef(false);
  useEffect(() => {
    // With organizations, the person still picks where Cuso goes.
    if (!autoStart || !websiteUrl || organizations.length > 0) return;
    if (started.current) return;
    started.current = true;
    const data = new FormData();
    data.set("websiteUrl", websiteUrl);
    startTransition(() => formAction(data));
  }, [autoStart, websiteUrl, organizations.length, formAction]);

  const chat = (
    // Remounts after each submit (useFocusFirstInvalid).
    <form
      key={state.attempt}
      ref={formRef}
      action={formAction}
      className="brief-bubble brief-hire"
    >
      {Object.entries(signUpContext).map(([key, value]) => (
        <input
          key={key}
          type="hidden"
          name={`${SIGN_UP_CONTEXT_FIELD}${key}`}
          value={value}
        />
      ))}
      <h2 className="brief-question" tabIndex={-1} data-brief-question>
        Hi, I'm {AGENT_NAME}. What's your website?
      </h2>
      {signedOut ? (
        <p className="brief-sub">
          Next you sign in with Sokosumi, and I start reading.
        </p>
      ) : null}
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
      <label className="ob-sr" htmlFor="ob-website">
        Your website
      </label>
      <div className="brief-note">
        <input
          id="ob-website"
          name="websiteUrl"
          required
          placeholder="yoursite.com"
          autoComplete="url"
          inputMode="url"
          defaultValue={state.websiteUrl}
          aria-invalid={errors.websiteUrl ? true : undefined}
          aria-describedby={websiteErrorId}
        />
        <StartButton
          label={signedOut ? "Continue" : "Start"}
          starting={starting}
        />
      </div>
      {errors.websiteUrl ? (
        <p id={websiteErrorId} className="alert" role="alert">
          {errors.websiteUrl}
        </p>
      ) : null}
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
    </form>
  );

  return (
    <div className="ob brief">
      <header className="ob-top brief-top">
        <Logo />
        <span />
        {signOut ? (
          <AccountMenu
            label="Account"
            signOut={signOut}
            cusoPicker={cusoPicker}
          />
        ) : (
          <a className="button button-secondary button-small" href="/signin">
            Sign in
          </a>
        )}
      </header>
      <StageBar marks={websiteMarks()} />
      <main className="brief-main brief-hero">
        <h1 className="ob-display">Your marketing month, briefed.</h1>
      </main>
      <BriefBar
        pose="needs-you"
        mode={{ kind: "asking", count: "", askKey: "website", chat }}
      />
    </div>
  );
}

function StartButton({
  label,
  starting,
}: {
  label: string;
  /** Reading started on its own, outside a submit. */
  starting: boolean;
}) {
  const pending = useFormStatus().pending || starting;
  return (
    <button type="submit" className="button" disabled={pending}>
      {pending ? (
        <Loader2 size={16} className="spin" aria-hidden="true" />
      ) : null}
      {pending ? "Starting" : label}
      {pending ? null : <ArrowRight size={16} aria-hidden="true" />}
    </button>
  );
}
