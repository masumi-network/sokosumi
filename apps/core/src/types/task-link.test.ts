import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { buildVisibleTaskLinksInclude } from "./task-link";

const VENDOR_ID = "01960001-0001-7001-8001-000000000001";

describe("buildVisibleTaskLinksInclude", () => {
  it("scopes delegated coworker peers by workspace when workspaceId is provided", () => {
    const peerWhere = {
      workspaceId: "ws_org",
      archivedAt: null,
      status: { not: TaskStatus.DRAFT },
      OR: [
        { coworkerId: "cow_agent" },
        {
          coworkerId: { not: "cow_agent" },
          coworker: { vendorId: VENDOR_ID },
        },
      ],
    };

    const include = buildVisibleTaskLinksInclude(
      {
        actor: "coworker",
        coworkerId: "cow_agent",
        vendorId: VENDOR_ID,
        context: {
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
      archivedAt: null,
      status: { not: TaskStatus.DRAFT },
      OR: [
        { coworkerId: "cow_agent" },
        {
          coworkerId: { not: "cow_agent" },
          coworker: { vendorId: VENDOR_ID },
        },
      ],
    };

    const include = buildVisibleTaskLinksInclude(
      {
        actor: "coworker",
        coworkerId: "cow_agent",
        vendorId: VENDOR_ID,
        context: {
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

  it("scopes bare coworker peers to assignee or same-vendor siblings and excludes drafts", () => {
    const peerWhere = {
      archivedAt: null,
      status: { not: TaskStatus.DRAFT },
      OR: [
        { coworkerId: "cow_agent" },
        {
          coworkerId: { not: "cow_agent" },
          coworker: { vendorId: VENDOR_ID },
        },
      ],
    };

    const include = buildVisibleTaskLinksInclude(
      {
        actor: "coworker",
        coworkerId: "cow_agent",
        vendorId: VENDOR_ID,
      },
      "ws_should_be_ignored",
    );

    expect(include.linksFrom?.where).toEqual({
      toTask: { is: peerWhere },
    });
  });
});
