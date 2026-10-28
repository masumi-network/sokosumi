"use client";

import "./onboarding/onboarding.css";

import { ArrowRight, Globe, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { OnboardFormState } from "../app/cmo-actions";
import { useFocusFirstInvalid } from "./form-field";
import { Logo } from "./logo";
import { CusoCursor } from "./onboarding/cuso-cursor";

const NEXT = [
  "Cuso studies your site, market and competitors",
  "You check your Brand Brain",
  "He plans four weeks, day by day, and you approve once",
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
      </header>
      <main className="ob-main">
        {/* Remounts after each submit (useFocusFirstInvalid). */}
        <form
          key={state.attempt}
          ref={formRef}
          action={formAction}
          className="ob-start"
        >
          <CusoCursor active={false} />
          <h1 className="ob-title">Hire Cuso, your AI CMO</h1>
          <p className="ob-lede">
            Tell Cuso where your business lives. He learns the rest, plans your
            month, and runs it.
          </p>
          {errors.form ? (
            <p className="ob-alert" role="alert" tabIndex={-1}>
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
          <label className="ob-field">
            <span className="ob-label">Your website</span>
            <span className="ob-url">
              <Globe size={16} aria-hidden="true" />
              <input
                name="websiteUrl"
                required
                placeholder="yourbusiness.com"
                autoComplete="url"
                inputMode="url"
                defaultValue={state.websiteUrl}
                aria-invalid={errors.websiteUrl ? true : undefined}
                aria-describedby={websiteErrorId}
              />
            </span>
          </label>
          {errors.websiteUrl ? (
            <p id={websiteErrorId} className="ob-alert">
              {errors.websiteUrl}
            </p>
          ) : null}
          <StartButton />
          <ol className="ob-next">
            {NEXT.map((line, index) => (
              <li key={line}>
                <span className="ob-dot" aria-hidden="true">
                  {index + 1}
                </span>
                {line}
              </li>
            ))}
          </ol>
        </form>
      </main>
    </div>
  );
}

function StartButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="ob-button ob-button-lg ob-start-button"
      disabled={pending}
    >
      {pending ? (
        <Loader2 size={16} className="ob-spin" aria-hidden="true" />
      ) : null}
      {pending ? "Starting" : "Start"}
      {pending ? null : <ArrowRight size={16} aria-hidden="true" />}
    </button>
  );
}
