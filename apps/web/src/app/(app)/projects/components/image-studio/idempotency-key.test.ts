import { describe, expect, it } from "vitest";

import { idempotencyKeyFor } from "../../../../../../agents/image-studio/agent/lib/identity";

/**
 * The key is the replay guard for a paid request, and Core caps it at 200
 * characters. The discriminator carries the prompt, which can run to
 * thousands — so an unhashed key turned a long prompt into a 400 rather than
 * a generation.
 */
const ctx = { session: { id: "wrun_1", turn: { id: "turn_0" } } };

describe("idempotencyKeyFor", () => {
  it("stays inside Core's limit for a maximum-length prompt", () => {
    const key = idempotencyKeyFor(ctx, `generate:${"x".repeat(4000)}`);
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key.length).toBeGreaterThanOrEqual(8);
  });

  it("is stable, so a durable retry of the same step replays rather than rebuys", () => {
    const first = idempotencyKeyFor(ctx, "generate:a cup");
    const second = idempotencyKeyFor(ctx, "generate:a cup");
    expect(first).toBe(second);
  });

  it("separates different intents within one turn", () => {
    expect(idempotencyKeyFor(ctx, "generate:a cup")).not.toBe(
      idempotencyKeyFor(ctx, "generate:a plate"),
    );
  });

  it("separates the same intent across turns", () => {
    const later = { session: { id: "wrun_1", turn: { id: "turn_1" } } };
    expect(idempotencyKeyFor(ctx, "generate:a cup")).not.toBe(
      idempotencyKeyFor(later, "generate:a cup"),
    );
  });
});
