import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recentProjectsStorageKey } from "@/hooks/use-recent-projects";

const mocks = vi.hoisted(() => ({
  userId: "user-1" as string | undefined,
  organizationId: "org-1" as string | null,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: mocks.userId
      ? {
          user: { id: mocks.userId },
          session: { activeOrganizationId: mocks.organizationId },
        }
      : null,
    isPending: !mocks.userId,
    isRefetching: false,
  }),
}));

import { RecordProjectVisit } from "./record-project-visit";

const scope = { userId: "user-1", organizationId: "org-1" as string | null };

function log(target = scope): unknown {
  return JSON.parse(
    localStorage.getItem(recentProjectsStorageKey(target)) ?? "null",
  );
}

describe("RecordProjectVisit", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.userId = "user-1";
    mocks.organizationId = "org-1";
  });

  it("records the visit and renders nothing", () => {
    const { container } = render(<RecordProjectVisit projectId="project-1" />);

    expect(log()).toEqual(["project-1"]);
    expect(container).toBeEmptyDOMElement();
  });

  it("puts the newest project in front of an earlier visit", () => {
    render(<RecordProjectVisit projectId="project-1" />);
    render(<RecordProjectVisit projectId="project-2" />);

    expect(log()).toEqual(["project-2", "project-1"]);
  });

  it("stays mounted without re-recording when nothing remounts it", () => {
    const view = render(<RecordProjectVisit projectId="project-1" />);
    render(<RecordProjectVisit projectId="project-2" />);
    view.rerender(<RecordProjectVisit projectId="project-1" />);

    expect(log()).toEqual(["project-2", "project-1"]);
  });

  it("does not record until the session is known", () => {
    mocks.userId = undefined;
    render(<RecordProjectVisit projectId="project-1" />);

    expect(localStorage.length).toBe(0);
  });

  it("writes a different log for another user in the same org", () => {
    render(<RecordProjectVisit projectId="project-1" />);
    mocks.userId = "user-2";
    render(<RecordProjectVisit projectId="project-2" />);

    expect(log()).toEqual(["project-1"]);
    expect(log({ userId: "user-2", organizationId: "org-1" })).toEqual([
      "project-2",
    ]);
  });
});
