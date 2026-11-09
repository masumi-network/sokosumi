"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { AGENT_NAME } from "../lib/agent";
import { SubmitButton } from "./submit-button";

interface StartOverProps {
  /** Archives this Cuso and opens the hiring form; a refusal comes back as text. */
  startOver: () => Promise<string | null>;
  className: string;
  label?: string;
}

/**
 * Hire Cuso again for another website. Asks once, since it stops this Cuso's
 * work and cancels his unsent posts.
 */
export function StartOver({
  startOver,
  className,
  label = "Start over",
}: StartOverProps) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => setAsking(true)}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {label}
      </button>
    );
  }
  return (
    <form
      className="start-over"
      action={async () => setError(await startOver())}
    >
      <p className="note">
        {AGENT_NAME} stops and his unsent posts are canceled. Your chat and
        files stay in Sokosumi.
      </p>
      <div className="start-over-actions">
        <SubmitButton className={className}>Start over</SubmitButton>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => setAsking(false)}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
