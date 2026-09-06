# Soko Bot operations runbook

In-process runtime, enablement, and turn drain: [deployment.md](./deployment.md).

## Crash-fenced Agent hire

An accepted `hire_agent` decision creates a unique Delegation reservation before seller-side execution. Local Job creation and the exact Delegation `jobId` link commit in the same serializable transaction. After seller dispatch starts, failures leave the decision `PROCESSING`; never reset it to `PENDING` or accept it by rerunning Job creation. That could hire and charge twice.

For a `PROCESSING` decision older than normal Job-start latency:

1. Inspect decision, its `decision:{decisionId}` Delegation, user, workspace, Agent proposal, and nearby Jobs in admin telemetry.
2. If Delegation already has `jobId`, same user may repeat accept request with same decision id. Core only finalizes `ACCEPTED`; it does not hire again.
3. If reservation has no `jobId`, keep decision fenced and escalate. Never infer a link from Job input shape, timestamps, or nearby rows. Repository ships no repair command.
4. If no local Job exists, confirm seller-side result before further action. Keep decision fenced while result is uncertain. Never infer failure from missing local row alone.
5. If repair or closure is required, build incident-scoped tooling first. It must support dry-run, validate expected current state, update link and decision in one transaction, be idempotent, and emit operator/incident evidence. Review and test it before production use; do not hand-edit state or invoke an unnamed script.

Admin fleet/detail views retain `PROCESSING` decision and reservation for diagnosis. User turn history retains resolved decisions but hides expired unresolved approvals.
