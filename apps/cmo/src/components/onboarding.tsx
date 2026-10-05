"use client";

import { useState } from "react";

export const GOALS = [
  "More sales",
  "More leads",
  "Brand awareness",
  "Launch something",
] as const;

interface OnboardingProps {
  onboard: (formData: FormData) => Promise<void>;
}

/** First run: one screen, then everything happens in the chat. */
export function Onboarding({ onboard }: OnboardingProps) {
  const [goal, setGoal] = useState<string>(GOALS[0]);
  return (
    <main className="landing">
      <form action={onboard} className="landing-inner">
        <h1>Hire Cuso, your AI CMO</h1>
        <p className="lead">
          Tell Cuso where your business lives and what you want. He learns the
          rest, plans your month, and runs it.
        </p>
        <label className="field">
          <span className="label">Your website</span>
          <input
            name="websiteUrl"
            required
            placeholder="yourbusiness.com"
            autoComplete="url"
          />
        </label>
        <fieldset className="field">
          <legend className="label">Main goal</legend>
          <div className="chips">
            {GOALS.map((option) => (
              <button
                key={option}
                type="button"
                className={option === goal ? "chip selected" : "chip"}
                aria-pressed={option === goal}
                onClick={() => setGoal(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <input type="hidden" name="goals" value={goal} />
        </fieldset>
        <div>
          <button type="submit" className="button">
            Start
          </button>
        </div>
      </form>
    </main>
  );
}
