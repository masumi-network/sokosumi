# Soko Bot operations runbook

## Crash-fenced Agent hire

An accepted `hire_agent` decision creates a unique Delegation reservation before seller-side execution. Local Job creation and the exact Delegation `jobId` link commit in the same serializable transaction. After seller dispatch starts, failures leave the decision `PROCESSING`; never reset it to `PENDING` or accept it by rerunning Job creation. That could hire and charge twice.

For a `PROCESSING` decision older than normal Job-start latency:

1. Inspect decision, its `decision:{decisionId}` Delegation, user, workspace, Agent proposal, and nearby Jobs in admin telemetry.
2. If Delegation already has `jobId`, same user may repeat accept request with same decision id. Core only finalizes `ACCEPTED`; it does not hire again.
3. If reservation has no `jobId`, keep decision fenced and escalate. Never infer a link from Job input shape, timestamps, or nearby rows. Repository ships no repair command.
4. If no local Job exists, confirm seller-side result before further action. Keep decision fenced while result is uncertain. Never infer failure from missing local row alone.
5. If repair or closure is required, build incident-scoped tooling first. It must support dry-run, validate expected current state, update link and decision in one transaction, be idempotent, and emit operator/incident evidence. Review and test it before production use; do not hand-edit state or invoke an unnamed script.

Admin fleet/detail views retain `PROCESSING` decision and reservation for diagnosis. User turn history retains resolved decisions but hides expired unresolved approvals.

## Stuck turn

Active-turn cron uses lease fencing for both crash windows. A stale `STARTING` turn with no session replays Eve create using same durable Core turn id as `operationId`; an attached turn resumes its Eve stream from persisted index. Context snapshot and turn are committed atomically before first dispatch, so replay always uses exact original packet. If deadline expires, Core cancels runtime, marks turn failed, clears uncertain session binding, and next turn creates fresh session. Use admin pause before manual investigation; resume only non-archived bot.

## Per-turn sessions

Core creates one fresh Eve session for every Core turn. The durable Core turn id is Eve's create `operationId`, making a lost acceptance response safe to replay without dispatching work twice. Core pre-feeds bounded recent conversation, current Sokosumi state, and canonical memory, so continuity never depends on Eve's non-idempotent follow-up endpoint or an earlier Sandbox. The prior completed session is reset after the replacement is durably acknowledged; cleanup failure is logged and Eve's session timeout remains the backstop.
