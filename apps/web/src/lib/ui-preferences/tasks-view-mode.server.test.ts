import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  userAgent: "",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (request.cookie ? { value: request.cookie } : undefined),
  }),
  headers: async () => new Headers({ "user-agent": request.userAgent }),
}));

import { getDefaultTasksViewMode } from "./tasks-view-mode.server";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("getDefaultTasksViewMode", () => {
  beforeEach(() => {
    request.cookie = undefined;
    request.userAgent = DESKTOP;
  });

  it("opens the board a link asks for over a saved List", async () => {
    request.cookie = "list";
    expect(await getDefaultTasksViewMode()).toBe("list");
    expect(await getDefaultTasksViewMode("board")).toBe("board");
  });

  it("opens the board a link asks for over the phone's List default", async () => {
    request.userAgent = IPHONE;
    expect(await getDefaultTasksViewMode()).toBe("list");
    expect(await getDefaultTasksViewMode("board")).toBe("board");
  });
});
