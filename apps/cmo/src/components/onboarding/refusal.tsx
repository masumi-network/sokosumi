import { ExternalLink } from "lucide-react";

/**
 * Why a step could not start. Out of credits comes with the way to top up,
 * so the founder is never left at a dead end.
 */
export function Refusal({
  text,
  topUpUrl,
}: {
  text: string;
  topUpUrl: string;
}) {
  if (!/credits/i.test(text)) {
    return (
      <p className="ob-note" role="alert">
        {text}
      </p>
    );
  }
  return (
    <p className="ob-note" role="alert">
      You're out of credits.{" "}
      <a className="ob-link" href={topUpUrl} target="_blank" rel="noreferrer">
        Top up on Sokosumi
        <ExternalLink size={12} aria-hidden="true" />
      </a>
      , then try again.
    </p>
  );
}
