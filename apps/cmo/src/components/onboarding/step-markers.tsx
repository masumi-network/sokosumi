"use client";

import { Check } from "lucide-react";

import { STEPS } from "./step";

/**
 * The four steps in the header. `reached` is where Cuso has got to; `current`
 * is the one on screen, which differs while the founder looks back. `open`
 * says which markers lead somewhere.
 */
interface StepMarkersProps {
  current: number;
  reached: number;
  open?: (index: number) => (() => void) | null;
}

export function StepMarkers({ current, reached, open }: StepMarkersProps) {
  return (
    <ol className="ob-steps" aria-label="Onboarding">
      {STEPS.map((step, index) => {
        const state =
          index === current ? "now" : index < reached ? "done" : "next";
        const action = index === current ? null : (open?.(index) ?? null);
        const content = (
          <>
            {state === "done" ? (
              <Check size={12} strokeWidth={3} aria-hidden="true" />
            ) : (
              <span aria-hidden="true">{index + 1}</span>
            )}
            {step.label}
          </>
        );
        return (
          <li
            key={step.id}
            className={`ob-step ${state}`}
            aria-current={state === "now" ? "step" : undefined}
          >
            {action ? (
              <button type="button" onClick={action}>
                {content}
              </button>
            ) : (
              <span>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
