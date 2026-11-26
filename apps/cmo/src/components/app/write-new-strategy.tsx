"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";

/**
 * A whole new strategy, written as a new hire's first one. The approved one
 * keeps running until the owner approves the new version.
 */
export function WriteNewStrategy({
  overview,
  onWriteNew,
  explain = `${AGENT_NAME} writes a whole new strategy and month from scratch. The current one keeps running until you approve the new one; then its posts that have not gone out are canceled.`,
}: {
  overview: CmoOverview;
  onWriteNew: () => Promise<string | null>;
  /** What starting over does, shown only in the confirm step. */
  explain?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const work = overview.work;
  if (work?.kind === "strategy" && work.status === "running") {
    return (
      <p className="muted" role="status">
        {AGENT_NAME} is writing a strategy. It shows here as the newest version;
        approve it to replace the current one.
      </p>
    );
  }
  if (!overview.viewerCanApprove) return null;
  if (!confirming) {
    return (
      <button
        type="button"
        className="button button-secondary button-small"
        onClick={() => setConfirming(true)}
      >
        Write a new strategy
      </button>
    );
  }
  return (
    <div className="card plan-week">
      <p>{explain}</p>
      <div className="actions">
        <button
          type="button"
          className="button button-small"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const refused = await onWriteNew();
              setRefusal(refused);
              if (!refused) setConfirming(false);
            })
          }
        >
          {pending ? "Starting…" : "Write it"}
        </button>
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Keep the current one
        </button>
      </div>
      {refusal ? <p role="alert">{refusal}</p> : null}
    </div>
  );
}
