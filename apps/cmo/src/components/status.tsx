import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

interface StatusDiscProps {
  status: "ok" | "warn" | "fail";
  /** The words beside the disc already say it, so the disc stays silent. */
  decorative?: boolean;
}

/** Done: green disc and check. Needs you: yellow disc and "!". Failed: ink disc and X. */
export function StatusDisc({ status, decorative = false }: StatusDiscProps) {
  const label =
    status === "ok"
      ? "Done"
      : status === "warn"
        ? "Needs your answer"
        : "Failed";
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? "true" : undefined}
      className={`status-disc status-disc-${status}`}
    >
      <span aria-hidden="true">
        {status === "ok" ? (
          <Check size={12} strokeWidth={3} />
        ) : status === "warn" ? (
          "!"
        ) : (
          <X size={12} strokeWidth={3} />
        )}
      </span>
    </span>
  );
}

interface StatusTextProps {
  children: ReactNode;
}

/** A done state in words with its disc: "Connected", "Approved". */
export function StatusText({ children }: StatusTextProps) {
  return (
    <span className="status-text">
      <StatusDisc status="ok" decorative />
      {children}
    </span>
  );
}
