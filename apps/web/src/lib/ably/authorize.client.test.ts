import type * as Ably from "ably";
import { describe, expect, it, vi } from "vitest";

import { authorizeAbly } from "./authorize.client";

function fakeAbly() {
  const authorize = vi.fn(async () => ({ token: "t" }) as Ably.TokenDetails);
  return {
    ably: { auth: { authorize } } as unknown as Ably.Realtime,
    authorize,
  };
}

describe("authorizeAbly", () => {
  it("sends one token request for callers in the same tick", async () => {
    const { ably, authorize } = fakeAbly();
    const [first, second] = await Promise.all([
      authorizeAbly(ably),
      authorizeAbly(ably),
    ]);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("starts the request after the callers of the tick have run", () => {
    const { ably, authorize } = fakeAbly();
    void authorizeAbly(ably);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("sends a new request for a caller that arrives after the first started", async () => {
    const { ably, authorize } = fakeAbly();
    let release: (value: Ably.TokenDetails) => void = () => {};
    authorize.mockImplementationOnce(
      () => new Promise<Ably.TokenDetails>((resolve) => (release = resolve)),
    );
    const first = authorizeAbly(ably);
    await Promise.resolve();
    expect(authorize).toHaveBeenCalledTimes(1);
    const second = authorizeAbly(ably);
    release({ token: "t" } as Ably.TokenDetails);
    await Promise.all([first, second]);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("keeps clients apart", async () => {
    const one = fakeAbly();
    const two = fakeAbly();
    await Promise.all([authorizeAbly(one.ably), authorizeAbly(two.ably)]);
    expect(one.authorize).toHaveBeenCalledTimes(1);
    expect(two.authorize).toHaveBeenCalledTimes(1);
  });
});
