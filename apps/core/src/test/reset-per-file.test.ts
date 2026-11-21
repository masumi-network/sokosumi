import { describe, expect, it } from "vitest";

import { evlogConfigAtFileStart } from "./core-log";

// Files share a worker (`reset-per-file.ts`); whichever file ran before this
// one, evlog's process-wide config must be back to a fresh process's.
// `setup.ts` then puts each test on a silent test drain, so the check reads
// the config as this file found it, before that drain was installed.
describe("reset-per-file", () => {
  it("starts each file on a fresh evlog config", () => {
    expect(evlogConfigAtFileStart()).toMatchObject({
      initialized: false,
      drain: undefined,
      silent: false,
    });
  });
});
