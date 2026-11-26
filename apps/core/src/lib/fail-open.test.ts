import { describe, expect, it } from "vitest";

import { failOpen } from "@/lib/fail-open";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";

describe("failOpen", () => {
  it("returns the fallback and warns with safe fields, not the error text", async () => {
    const entries = expectCoreLog("warn", "Calendar read failed");
    const events = await Promise.reject(
      new Error("provider said secret things"),
    ).catch(
      failOpen(
        [] as string[],
        { operation: "test" },
        {
          message: "Calendar read failed",
          why: "The provider call threw",
        },
      ),
    );

    expect(events).toEqual([]);
    expect(entries[0]?.why).toBe("The provider call threw");
    expect(JSON.stringify(coreLogEvents())).toContain('"errorName":"Error"');
    expect(JSON.stringify(coreLogEvents())).not.toContain("secret things");
  });
});
