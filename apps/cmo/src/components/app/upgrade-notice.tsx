"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { useEventListener } from "../../hooks/effects/use-event-listener";
import { AGENT_NAME } from "../../lib/agent";
import { CusoAvatar } from "../cuso";

export type CmoUpgrade = NonNullable<CmoOverview["upgrade"]>;

/**
 * Shown once per move onto a newer version: what changed for the owner, in
 * plain lines, and one way out.
 */
export function UpgradeNotice({
  upgrade,
  onClose,
}: {
  upgrade: CmoUpgrade;
  onClose: () => void;
}) {
  useEventListener("window", "keydown", (event) => {
    if (event.key === "Escape") onClose();
  });
  return (
    <>
      <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="upgrade-notice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-notice-title"
      >
        <CusoAvatar pose="done" size={48} />
        <h2 id="upgrade-notice-title">{AGENT_NAME} just got better</h2>
        <ul>
          {upgrade.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <button type="button" className="button" autoFocus onClick={onClose}>
          Got it
        </button>
      </div>
    </>
  );
}
