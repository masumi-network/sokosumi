import "./onboarding/onboarding.css";

import type { CmoCuso } from "@sokosumi/core-client";
import { ChevronRight, Plus } from "lucide-react";

import { AGENT_NAME } from "../lib/agent";
import { BusinessMark } from "./business-mark";
import { Logo } from "./logo";

interface CusoPickerProps {
  /** Every Cuso the person can work with, newest first, as Core lists them. */
  cusos: CmoCuso[];
  /** Core's hire allowlist lets this person hire another Cuso. */
  mayHire: boolean;
}

/**
 * The Cuso picker (ADR 0065): one row per Cuso, across the person's
 * organizations, then "Hire a new Cuso" when the person may hire. Opening a row names his Project in
 * the address, which this device then remembers.
 */
export function CusoPicker({ cusos, mayHire }: CusoPickerProps) {
  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
      </header>
      <main className="ob-main">
        <div className="ob-picker">
          <h1 className="ob-h1">Your {AGENT_NAME}s</h1>
          <ul className="list panel">
            {cusos.map((cuso) => (
              <li key={cuso.projectId} className="li">
                <a
                  className="ob-picker-row"
                  href={`/?project=${encodeURIComponent(cuso.projectId)}`}
                >
                  <BusinessMark overview={cuso} size={32} />
                  <span className="grow">
                    <b>{cuso.businessName}</b>
                    <br />
                    <span className="note">
                      {cuso.organizationName}
                      {cuso.hiring ? " · Hiring" : ""}
                    </span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </a>
              </li>
            ))}
            {mayHire && (
              <li className="li">
                <a className="ob-picker-row" href="/?hire=1">
                  <Plus size={16} aria-hidden="true" />
                  <span className="grow">Hire a new {AGENT_NAME}</span>
                </a>
              </li>
            )}
          </ul>
        </div>
      </main>
    </div>
  );
}
