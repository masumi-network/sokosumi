import { beforeEach, describe, expect, it, vi } from "vitest";

import { allowNewsletterSignup } from "./signup-limit";

const m = vi.hoisted(() => ({ getRedisClient: vi.fn(), eval: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedisClient: m.getRedisClient }));

beforeEach(() => {
  vi.resetAllMocks();
  m.getRedisClient.mockReturnValue({ eval: m.eval });
  m.eval.mockResolvedValue(1);
});

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.com", { headers });
}

describe("newsletter signup IP limit", () => {
  it.each([
    [1, true],
    [10, true],
    [11, false],
  ])("allows ten requests in a window: count %s", async (count, allowed) => {
    m.eval.mockResolvedValue(count);
    expect(
      await allowNewsletterSignup(
        "newsletter-1",
        request({ "x-forwarded-for": "198.51.100.1, 198.51.100.2" }),
      ),
    ).toBe(allowed);
    expect(m.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("expire", KEYS[1], 600)'),
      1,
      "newsletter:signup:newsletter-1:198.51.100.1",
    );
  });

  it("prefers Vercel's trusted forwarded address and separates newsletters", async () => {
    const input = request({
      "x-vercel-forwarded-for": "2001:db8::1",
      "x-forwarded-for": "198.51.100.1",
    });
    await allowNewsletterSignup("newsletter-1", input);
    await allowNewsletterSignup("newsletter-2", input);
    expect(m.eval).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      1,
      "newsletter:signup:newsletter-1:2001:db8::1",
    );
    expect(m.eval).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      1,
      "newsletter:signup:newsletter-2:2001:db8::1",
    );
  });

  it.each(["", "invalid"])(
    "shares a fallback bucket when an IP is unavailable: %j",
    async (ip) => {
      await allowNewsletterSignup(
        "newsletter-1",
        request(ip ? { "x-forwarded-for": ip } : {}),
      );
      expect(m.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "newsletter:signup:newsletter-1:unknown",
      );
    },
  );

  it("keeps requests available without Redis and on Redis errors", async () => {
    m.getRedisClient.mockReturnValueOnce(null);
    expect(await allowNewsletterSignup("newsletter-1", request())).toBe(true);
    expect(m.eval).not.toHaveBeenCalled();
    m.eval.mockRejectedValue(new Error("test Redis outage"));
    expect(await allowNewsletterSignup("newsletter-1", request())).toBe(true);
  });
});
