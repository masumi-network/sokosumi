import {
  OutOfCredits,
  type SkipSubscription,
  SkipSubscriptionButton,
  type StartTopUp,
  TopUpButton,
} from "../top-up";

/**
 * Why a step could not start. Out of credits comes with the way to top up,
 * or to subscribe for a Cuso paused without a plan, so the founder is never
 * left at a dead end.
 */
export function Refusal({
  text,
  topUp,
  subscribe = null,
  skip = null,
}: {
  text: string;
  /** The top-up checkout, or null when this Cuso may not top up. */
  topUp: StartTopUp | null;
  /** The plan checkout, set when Cuso is paused without a CMO plan. */
  subscribe?: StartTopUp | null;
  /** Continues without a subscription, for a tester Core allows it. */
  skip?: SkipSubscription | null;
}) {
  if (/credits/i.test(text)) {
    return (
      <div className="ob-retry">
        <OutOfCredits topUp={topUp} subscribe={subscribe} skip={skip} />
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
        {skip ? <SkipSubscriptionButton skip={skip} /> : null}
      </div>
    );
  }
  return (
    <p className="note" role="alert">
      {text}
    </p>
  );
}
