import { OutOfCredits, type StartTopUp } from "../top-up";

/**
 * Why a step could not start. Out of credits comes with the way to top up,
 * so the founder is never left at a dead end.
 */
export function Refusal({
  text,
  topUp,
}: {
  text: string;
  /** The top-up checkout, or null when this Cuso may not top up. */
  topUp: StartTopUp | null;
}) {
  if (!/credits/i.test(text)) {
    return (
      <p className="note" role="alert">
        {text}
      </p>
    );
  }
  return (
    <div className="ob-retry">
      <OutOfCredits topUp={topUp} />
    </div>
  );
}
