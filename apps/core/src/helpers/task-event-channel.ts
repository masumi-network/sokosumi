import { Channel } from "@sokosumi/database";

interface ChannelOriginInput {
  channel?: Channel;
  origin?: Channel;
}

interface ChannelOriginIssueContext {
  addIssue: (issue: {
    code: "custom";
    message: string;
    path: Array<string | number>;
  }) => void;
}

/**
 * Resolves the canonical task-event channel from request body fields.
 * Prefer `channel`; fall back to deprecated `origin`; default SOKOSUMI.
 * Callers must reject conflicting pairs via {@link refineChannelOriginConflict}.
 */
export function resolveTaskEventChannel(input: ChannelOriginInput): Channel {
  return input.channel ?? input.origin ?? Channel.SOKOSUMI;
}

export function refineChannelOriginConflict(
  data: ChannelOriginInput,
  ctx: ChannelOriginIssueContext,
): void {
  if (
    data.channel !== undefined &&
    data.origin !== undefined &&
    data.channel !== data.origin
  ) {
    ctx.addIssue({
      code: "custom",
      message: "channel and origin must match when both are provided",
      path: ["channel"],
    });
  }
}
