import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { buildVisibleTaskLinksInclude } from "./task-link";

describe("buildVisibleTaskLinksInclude", () => {
  it("scopes delegated coworker peers by workspace when workspaceId is provided", () => {
    const peerWhere = {
      workspaceId: "ws_org",
      archivedAt: null,
      pendingVendorGrantId: null,
    };

    const include = buildVisibleTaskLinksInclude(
      {
        actor: "coworker",
        coworkerId: "cow_agent",
        vendorId: "01960001-0001-7001-8001-000000000001",
        delegation: {
          userId: "user_delegated",
          organizationId: "org_1",
        },
      },
      "ws_org",
    );

    expect(include.linksFrom?.where).toEqual({
      toTask: { is: peerWhere },
    });
    expect(include.linksTo?.where).toEqual({
      fromTask: { is: peerWhere },
    });
  });

  it("scopes delegated coworker peers by delegated userId when workspaceId is absent", () => {
    const peerWhere = {
      userId: "user_delegated",
      pendingVendorGrantId: null,
    };

    const include = buildVisibleTaskLinksInclude(
      {
        actor: "coworker",
        coworkerId: "cow_agent",
        vendorId: "01960001-0001-7001-8001-000000000001",
        delegation: {
          userId: "user_delegated",
          organizationId: null,
        },
      },
      undefined,
    );

    expect(include.linksFrom?.where).toEqual({
      toTask: { is: peerWhere },
    });
  });

  it("keeps non-delegated coworker peer filter on coworkerId and excludes drafts", () => {
    const peerWhere = {
      coworkerId: "cow_agent",
      archivedAt: null,
      pendingVendorGrantId: null,
      NOT: { status: { in: [TaskStatus.DRAFT] } },
    };

    const include = buildVisibleTaskLinksInclude(
      {
        actor: "coworker",
        coworkerId: "cow_agent",
        vendorId: "01960001-0001-7001-8001-000000000001",
      },
      "ws_should_be_ignored",
    );

    expect(include.linksFrom?.where).toEqual({
      toTask: { is: peerWhere },
    });
  });
});
