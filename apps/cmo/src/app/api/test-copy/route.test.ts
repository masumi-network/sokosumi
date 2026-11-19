import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { check, tearDown, core } = vi.hoisted(() => ({
  check: vi.fn(),
  tearDown: vi.fn(),
  core: vi.fn(),
}));
vi.mock("@sokosumi/core-client", () => ({
  checkCmoTestCopyForProject: check,
  tearDownCmoTestCopyForProject: tearDown,
}));
vi.mock("../../../lib/core", () => ({ coreForCurrentUser: core }));

import { GET, POST } from "./route";

const request = (query = "project=project-copy") =>
  new NextRequest(`http://localhost:3110/api/test-copy?${query}`);

describe("test copy check and teardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    core.mockResolvedValue({ client: "core" });
  });

  it("answers Core's check for the named Project", async () => {
    check.mockResolvedValue({
      data: { data: { clean: true } },
      response: { status: 200 },
    });
    const response = await GET(request());
    expect(check).toHaveBeenCalledWith({
      client: "core",
      path: { projectId: "project-copy" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clean: true });
    expect(tearDown).not.toHaveBeenCalled();
  });

  it("tears down only on POST, and passes Core's refusal on", async () => {
    tearDown.mockResolvedValue({
      error: { message: "Not yours" },
      response: { status: 403 },
    });
    const response = await POST(request());
    expect(tearDown).toHaveBeenCalledWith({
      client: "core",
      path: { projectId: "project-copy" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Not yours" });
  });

  it("asks nothing of Core without a Project or a signed-in person", async () => {
    expect((await POST(request(""))).status).toBe(400);
    core.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(tearDown).not.toHaveBeenCalled();
  });
});
