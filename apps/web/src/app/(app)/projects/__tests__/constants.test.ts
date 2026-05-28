import { describe, expect, it } from "vitest";

import { UNASSIGNED_PROJECT_QUERY } from "@/app/projects/constants";
import type { GetJobsData } from "@/lib/clients/generated/core/types.gen";

describe("UNASSIGNED_PROJECT_QUERY", () => {
  it("matches the Core API query param for unassigned project filters", () => {
    const query: NonNullable<GetJobsData["query"]> = {
      projectId: UNASSIGNED_PROJECT_QUERY,
    };

    expect(query.projectId).toBe("null");
  });
});
