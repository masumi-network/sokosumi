"use client";

import "./onboarding/onboarding.css";

import type { UserWorkspace } from "@sokosumi/core-client";
import {
  ArrowRight,
  Globe,
  Loader2,
  Megaphone,
  Rocket,
  ShoppingBag,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Logo } from "./logo";
import { CusoCursor } from "./onboarding/cuso-cursor";

export const GOALS = [
  { label: "More sales", Icon: ShoppingBag },
  { label: "More leads", Icon: UserPlus },
  { label: "Brand awareness", Icon: Megaphone },
  { label: "Launch something", Icon: Rocket },
] as const;

const NEXT = [
  "Cuso studies your site, market and competitors",
  "You check your Brand Brain",
  "He plans four weeks, day by day, and you approve once",
];

interface OnboardingProps {
  /** Where Cuso is hired (ADR 0053): the person's preferred Workspace. */
  workspace: Pick<UserWorkspace, "id" | "kind" | "name" | "websiteUrl">;
  onboard: (formData: FormData) => Promise<void>;
}

/**
 * Hiring Cuso, step one: the website and the one goal that matters most.
 * An organization's stored website starts the field; the person can change it.
 */
export function Onboarding({ workspace, onboard }: OnboardingProps) {
  const [goal, setGoal] = useState<string>(GOALS[0].label);
  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
      </header>
      <main className="ob-main">
        <form action={onboard} className="ob-start">
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <CusoCursor active={false} />
          <h1 className="ob-title">Hire Cuso, your AI CMO</h1>
          <p className="ob-lede">
            Tell Cuso where your business lives and what you want. He learns the
            rest, plans your month, and runs it.
          </p>
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
                defaultValue={workspace.websiteUrl ?? ""}
              />
            </span>
          </label>
          <fieldset className="ob-field">
            <legend className="ob-label">Main goal</legend>
            <div className="ob-goals">
              {GOALS.map(({ label, Icon }) => (
                <button
                  key={label}
                  type="button"
                  className={label === goal ? "ob-goal selected" : "ob-goal"}
                  aria-pressed={label === goal}
                  onClick={() => setGoal(label)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            <input type="hidden" name="goals" value={goal} />
          </fieldset>
          {workspace.kind === "organization" ? (
            <p className="ob-lede">
              Cuso works in {workspace.name} and uses its plan and credits.
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
