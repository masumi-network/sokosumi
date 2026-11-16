import { type Prisma } from "@sokosumi/database";
import {
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_SANDBOX_CAPABILITIES,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";

export const DECISION_TTL_MS = 24 * 60 * 60 * 1_000;

export const TOOL_CALL_STALE_MS = 2 * 60 * 1_000;

export const TOOL_CALLS_PER_FIFTEEN_MINUTES = 64;

/**
 * Core tools that only read. They get their own, larger budget: a script
 * paging three years of mail reads thousands of times, and a six-hour CRM run
 * hit the shared cap of 1,536 after 97 minutes. Anything else (a change, a
 * background run, a provider refresh) counts against the turn's limit; sandbox
 * tools are recorded but not counted.
 */
/** Exa searches one turn may run: a full research uses about twenty-five. */
export const EXA_SEARCHES_PER_TURN = 30;

export const CORE_READ_CAPABILITIES: readonly SokoBotCapability[] =
  SOKO_BOT_CAPABILITIES.filter(
    (capability) =>
      /^(get|list|read|search|find)_|^(refresh_context|preview_result|evaluate_with_jev)$/.test(
        capability,
      ) && !SOKO_BOT_SANDBOX_CAPABILITIES.some((tool) => tool === capability),
  );

export const CORE_READ_CALLS = {
  capability: { in: [...CORE_READ_CAPABILITIES] },
} satisfies Prisma.SokoBotToolCallWhereInput;

export const CORE_WRITE_CALLS = {
  capability: {
    notIn: [...SOKO_BOT_SANDBOX_CAPABILITIES, ...CORE_READ_CAPABILITIES],
  },
} satisfies Prisma.SokoBotToolCallWhereInput;

export const READ_CALLS_PER_WRITE_CALL = 10;

/** Enough for "ask Nina and Tom", far short of an organization. */
export const MAX_DIRECTS_OPENED_PER_TURN = 5;

/** A few Coworkers sounded out before committing work, not a survey. */
export const MAX_COWORKER_QUESTIONS_PER_TURN = 3;

/** Enough for a few variations; each one spends the owner's credits. */
export const MAX_IMAGES_PER_TURN = 4;

/** A video costs several images and takes minutes; two is a choice, not a batch. */
export const MAX_VIDEOS_PER_TURN = 2;
