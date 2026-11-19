import { describe, expect, it } from "vitest";

import { readLegacyBackgroundFailure } from "./background-failure";

const metadata = {
  soko_bot: { turn_id: "turn", background_run_title: "Review" },
};

describe("readLegacyBackgroundFailure", () => {
  it("replaces provider text in a historical background failure and preserves the mention", () => {
    expect(
      readLegacyBackgroundFailure(
        '@owner Background run "Review" failed before it could report. (Provider diagnostic\nwith parentheses (2))',
        metadata,
      ),
    ).toEqual({
      content:
        '@owner Background run "Review" failed before it could report. Something went wrong on our side. Try again. If it keeps happening, contact support.',
      metadata: {
        soko_bot: { ...metadata.soko_bot, background_failure_kind: "unknown" },
      },
    });
  });

  it("keeps the recorded deadline message", () => {
    expect(
      readLegacyBackgroundFailure(
        'Background run "Review" ran out of time before it could report. (Soko Bot turn exceeded its execution deadline)',
        metadata,
      ),
    ).toMatchObject({
      content:
        'Background run "Review" ran out of time before it could report.',
      metadata: {
        soko_bot: { background_failure_kind: "turn_deadline_exceeded" },
      },
    });
  });

  it("leaves a completed report alone", () => {
    expect(
      readLegacyBackgroundFailure("Review complete.", metadata),
    ).toBeNull();
  });
});
