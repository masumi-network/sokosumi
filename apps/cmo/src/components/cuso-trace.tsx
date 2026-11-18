import type { CmoOverview } from "@sokosumi/core-client";
import { AGENT_NAME } from "../lib/agent";
import { type CusoTrace, latestThought } from "../lib/trace";

type Activity = CmoOverview["activity"];

/** The model's newest reasoning, as one quiet line under what Cuso is doing. */
export function ReasoningLine({ activity }: { activity: Activity }) {
  const thought = latestThought(activity?.reasoning);
  return thought ? <p className="working-why">{thought}</p> : null;
}

/** Cuso at work in the chat: the step he is on and why, updating live. */
export function Working({ activity }: { activity: Activity }) {
  return (
    <div className="working" role="status" aria-live="polite">
      <p className="working-step">
        <span className="typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{activity?.step ?? `${AGENT_NAME} is working`}</span>
      </p>
      <ReasoningLine activity={activity} />
    </div>
  );
}

/** A summary's `**headings**` as bold; everything else as written. */
function emphasised(text: string): React.ReactNode[] {
  return text
    .split(/\*\*([^*\n]+)\*\*/)
    .map((part, index) =>
      index % 2 === 1 ? <b key={`${index}-${part}`}>{part}</b> : part,
    );
}

/** Under a reply: the steps Cuso took and his reasoning, folded away. */
export function HowIGotHere({ trace }: { trace: CusoTrace }) {
  return (
    <details className="trace">
      <summary>How I got here</summary>
      <div className="trace-body">
        {trace.steps.length > 0 ? (
          <ul className="trace-steps">
            {trace.steps.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ul>
        ) : null}
        {trace.thoughts.map((thought, index) => (
          <p key={`${index}-${thought.slice(0, 24)}`} className="working-why">
            {emphasised(thought)}
          </p>
        ))}
      </div>
    </details>
  );
}
