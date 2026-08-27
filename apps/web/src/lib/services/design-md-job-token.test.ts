import { describe, expect, it } from "vitest";

import {
  createDesignMdJobToken,
  verifyDesignMdJobToken,
} from "./design-md-job-token";

const secret = "test-secret";

describe("design-md job token", () => {
  it("creates and verifies a valid job token", () => {
    const token = createDesignMdJobToken(
      secret,
      "user-1",
      { type: "user" },
      "job_1",
    );

    expect(
      verifyDesignMdJobToken(
        secret,
        "user-1",
        { type: "user" },
        "job_1",
        token,
      ),
    ).toBe(true);
  });

  it("rejects tokens for a different user, owner, or job", () => {
    const token = createDesignMdJobToken(
      secret,
      "user-1",
      { type: "user" },
      "job_1",
    );

    expect(
      verifyDesignMdJobToken(
        secret,
        "user-2",
        { type: "user" },
        "job_1",
        token,
      ),
    ).toBe(false);
    expect(
      verifyDesignMdJobToken(
        secret,
        "user-1",
        { type: "organization", organizationId: "org-1" },
        "job_1",
        token,
      ),
    ).toBe(false);
    expect(
      verifyDesignMdJobToken(
        secret,
        "user-1",
        { type: "user" },
        "job_2",
        token,
      ),
    ).toBe(false);
  });

  it("scopes project tokens to the project id", () => {
    const token = createDesignMdJobToken(
      secret,
      "user-1",
      { type: "project", projectId: "project-1" },
      "job_1",
    );

    expect(
      verifyDesignMdJobToken(
        secret,
        "user-1",
        { type: "project", projectId: "project-1" },
        "job_1",
        token,
      ),
    ).toBe(true);
    expect(
      verifyDesignMdJobToken(
        secret,
        "user-1",
        { type: "project", projectId: "project-2" },
        "job_1",
        token,
      ),
    ).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(
      verifyDesignMdJobToken(
        secret,
        "user-1",
        { type: "user" },
        "job_1",
        "not-a-token",
      ),
    ).toBe(false);
  });
});
