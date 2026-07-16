import { z } from "@hono/zod-openapi";
import { Channel } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  refineChannelOriginConflict,
  resolveTaskEventChannel,
} from "./task-event-channel";

describe("resolveTaskEventChannel", () => {
  it("prefers channel when only channel is set", () => {
    expect(resolveTaskEventChannel({ channel: Channel.SLACK })).toBe(
      Channel.SLACK,
    );
  });

  it("uses deprecated origin when only origin is set", () => {
    expect(resolveTaskEventChannel({ origin: Channel.EMAIL })).toBe(
      Channel.EMAIL,
    );
  });

  it("uses the shared value when both match", () => {
    expect(
      resolveTaskEventChannel({
        channel: Channel.DISCORD,
        origin: Channel.DISCORD,
      }),
    ).toBe(Channel.DISCORD);
  });

  it("defaults to SOKOSUMI when neither is set", () => {
    expect(resolveTaskEventChannel({})).toBe(Channel.SOKOSUMI);
  });
});

describe("refineChannelOriginConflict", () => {
  const schema = z
    .object({
      channel: z.enum(Channel).optional(),
      origin: z.enum(Channel).optional(),
    })
    .superRefine(refineChannelOriginConflict);

  it("accepts matching channel and origin", () => {
    const result = schema.safeParse({
      channel: Channel.SLACK,
      origin: Channel.SLACK,
    });
    expect(result.success).toBe(true);
  });

  it("rejects conflicting channel and origin", () => {
    const result = schema.safeParse({
      channel: Channel.SLACK,
      origin: Channel.EMAIL,
    });
    expect(result.success).toBe(false);
  });
});
