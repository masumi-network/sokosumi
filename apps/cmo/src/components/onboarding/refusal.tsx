import { OutOfCredits, type StartTopUp, TopUpButton } from "../top-up";

/**
 * Why a step could not start. Out of credits comes with the way to top up,
 * or to subscribe for a Cuso paused without a plan, so the founder is never
 * left at a dead end.
 */
export function Refusal({
  text,
  topUp,
  subscribe = null,
}: {
  text: string;
  /** The top-up checkout, or null when this Cuso may not top up. */
  topUp: StartTopUp | null;
  /** The plan checkout, set when Cuso is paused without a CMO plan. */
  subscribe?: StartTopUp | null;
}) {
  if (/credits/i.test(text)) {
    return (
      <div className="ob-retry">
        <OutOfCredits topUp={topUp} subscribe={subscribe} />
      </div>
    );
  }
  if (subscribe && /paused/i.test(text)) {
    return (
      <div className="ob-retry">
        <span className="note" role="alert">
          {text}
        </span>
        <TopUpButton
          startTopUp={subscribe}
          className="button button-secondary button-small"
          label="Subscribe"
        />
      </div>
    );
  }
  return (
    <p className="note" role="alert">
      {text}
    </p>
  );
}
