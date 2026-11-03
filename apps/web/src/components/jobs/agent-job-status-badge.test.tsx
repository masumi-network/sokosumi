import { AgentJobStatus } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { getAgentStatusDotColorClass } from "@/components/jobs/agent-job-status-badge";
import { getToneStyle } from "@/components/ui/status-marker";

describe("getAgentStatusDotColorClass", () => {
  it("reads dots from the shared StatusMarker hue table", () => {
    expect(getAgentStatusDotColorClass(AgentJobStatus.COMPLETED)).toBe(
      getToneStyle({ hue: "resolved", weight: "filled" }).dot,
    );
    expect(getAgentStatusDotColorClass(AgentJobStatus.FAILED)).toBe(
      getToneStyle({ hue: "fault", weight: "filled" }).dot,
    );
    expect(getAgentStatusDotColorClass(AgentJobStatus.AWAITING_INPUT)).toBe(
      getToneStyle({ hue: "blocked", weight: "filled" }).dot,
    );
    expect(getAgentStatusDotColorClass(AgentJobStatus.AWAITING_PAYMENT)).toBe(
      getToneStyle({ hue: "blocked", weight: "filled" }).dot,
    );
    expect(getAgentStatusDotColorClass(AgentJobStatus.RUNNING)).toBe(
      getToneStyle({ hue: "active", weight: "filled" }).dot,
    );
    expect(getAgentStatusDotColorClass(AgentJobStatus.INITIATED)).toBe(
      getToneStyle({ hue: "active", weight: "filled" }).dot,
    );
  });
});
