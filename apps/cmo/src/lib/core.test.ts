import { beforeEach, expect, it, vi } from "vitest";

const incoming = new Headers({
  cookie: "token=old",
  "x-forwarded-for": "1.2.3.4",
});
let jar = "token=old";

vi.mock("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({ toString: () => jar }),
}));

const { renderRequestHeaders } = await import("./core");

beforeEach(() => {
  jar = "token=old";
});

it("renders with the cookies a server action just renewed, not the request's old Cookie header", async () => {
  jar = "token=new";
  const current = await renderRequestHeaders();
  expect(current.get("cookie")).toBe("token=new");
  expect(current.get("x-forwarded-for")).toBe("1.2.3.4");
  expect(incoming.get("cookie")).toBe("token=old");
});
