import type { ProjectSeoMonitor } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";
import {
  seoMonitorBlock,
  seoMonitorCardHidden,
  seoMonitorChangeSummary,
  seoMonitorPagesDiffer,
  seoMonitorPlan,
  seoMonitorRuleBelowReleased,
  seoMonitorRuleOf,
  seoMonitorRunsLeft,
  seoMonitorWhen,
} from "./seo-monitor-model";

const actions = (patch: { canEdit?: boolean; canCreateMonitor?: boolean }) => ({
  availableActions: {
    canEdit: true,
    canRequestAnalysis: true,
    canCreateMonitor: true,
    ...patch,
  },
  scope: { pageIds: ["page-1"] },
});
const rule = (patch: Partial<ProjectSeoMonitor["rule"]> = {}) => ({
  expr: "0 9 * * MON",
  timezone: "Europe/Berlin",
  endsMode: "AFTER" as const,
  targetRunCount: 4,
  ...patch,
});

describe("SEO monitor card model", () => {
  it("names why no monitor can be made, the reader's rights first", () => {
    expect(seoMonitorBlock(actions({}) as never)).toBeNull();
    expect(
      seoMonitorBlock(
        actions({ canEdit: false, canCreateMonitor: false }) as never,
      ),
    ).toBe("readOnly");
    expect(
      seoMonitorBlock(actions({ canCreateMonitor: undefined }) as never),
    ).toBe("service");
    expect(
      seoMonitorBlock({ ...actions({}), scope: { pageIds: [] } } as never),
    ).toBe("noPages");
  });

  it("hides an empty card where the reader cannot make a monitor", () => {
    const empty = { ...actions({}), monitors: [] };
    expect(seoMonitorCardHidden(empty as never)).toBe(false);
    expect(
      seoMonitorCardHidden({
        ...actions({ canEdit: false }),
        monitors: [],
      } as never),
    ).toBe(true);
    // Checks can start but schedules cannot: the card's one button could not work.
    expect(
      seoMonitorCardHidden({
        ...actions({ canCreateMonitor: false }),
        monitors: [],
      } as never),
    ).toBe(true);
    // No pages yet: the card shows, and its note says to add pages first.
    expect(
      seoMonitorCardHidden({
        ...actions({}),
        scope: { pageIds: [] },
        monitors: [],
      } as never),
    ).toBe(false);
    const paused = actions({ canCreateMonitor: false });
    paused.availableActions.canRequestAnalysis = false;
    expect(seoMonitorCardHidden({ ...paused, monitors: [] } as never)).toBe(
      true,
    );
    // A monitor that exists always shows, with its commands or the reason they are gone.
    expect(seoMonitorCardHidden({ ...paused, monitors: [{}] } as never)).toBe(
      false,
    );
  });

  it("counts the scheduled runs left, none for an ended monitor and no count for one that runs until stopped", () => {
    expect(
      seoMonitorRunsLeft({ rule: rule(), releasedCount: 1, state: "ACTIVE" }),
    ).toBe(3);
    expect(
      seoMonitorRunsLeft({ rule: rule(), releasedCount: 6, state: "ACTIVE" }),
    ).toBe(0);
    expect(
      seoMonitorRunsLeft({ rule: rule(), releasedCount: 1, state: "ENDED" }),
    ).toBe(0);
    expect(
      seoMonitorRunsLeft({
        rule: rule({ endsMode: "NEVER", targetRunCount: null }),
        releasedCount: 9,
        state: "ACTIVE",
      }),
    ).toBeNull();
    // An ended monitor that ran until stopped has no runs left either.
    expect(
      seoMonitorRunsLeft({
        rule: rule({ endsMode: "NEVER", targetRunCount: null }),
        releasedCount: 9,
        state: "ENDED",
      }),
    ).toBe(0);
  });

  it("warns only when the selected page group holds other pages than the monitor froze", () => {
    const monitor = { pageIds: ["a", "b"] };
    expect(seoMonitorPagesDiffer(monitor, ["b", "a"])).toBe(false);
    expect(seoMonitorPagesDiffer(monitor, ["a", "b", "c"])).toBe(true);
    expect(seoMonitorPagesDiffer(monitor, ["a"])).toBe(true);
    expect(seoMonitorPagesDiffer(monitor, ["a", "c"])).toBe(true);
  });

  it("reads rises as the moves that are not drops", () => {
    const change = {
      from: new Date(),
      to: new Date(),
      comparable: true,
      newFailureCount: 0,
      fixedCount: 0,
      newFailures: [],
      fixed: [],
      moves: [],
      moveCount: 3,
      dropCount: 1,
    };
    expect(seoMonitorChangeSummary(change)).toEqual({
      kind: "changed",
      newFailures: 0,
      fixed: 0,
      drops: 1,
      rises: 2,
    });
    expect(
      seoMonitorChangeSummary({ ...change, moveCount: 0, dropCount: 0 }),
    ).toEqual({ kind: "same" });
    expect(seoMonitorChangeSummary({ ...change, comparable: false })).toEqual({
      kind: "notComparable",
    });
    expect(seoMonitorChangeSummary(null)).toEqual({ kind: "none" });
  });

  it("lists weekdays Monday first, the way the editor shows the week", () => {
    expect(seoMonitorPlan({ expr: "30 7 * * SUN,MON,WED" })).toEqual({
      repeat: "weekly",
      hour: 7,
      minute: 30,
      weekdays: ["MON", "WED", "SUN"],
    });
  });

  it("saves a stored rule back unchanged and reads a legacy numeric weekday", () => {
    for (const expr of ["30 7 * * MON,WED", "0 9 * * *", "15 6 31 * *"]) {
      expect(seoMonitorRuleOf(seoMonitorWhen(rule({ expr }), "UTC"))).toEqual(
        rule({ expr }),
      );
    }
    expect(
      seoMonitorRuleOf(seoMonitorWhen(rule({ expr: "0 9 * * 1" }), "UTC"))
        ?.expr,
    ).toBe("0 9 * * MON");
    const never = rule({ endsMode: "NEVER", targetRunCount: null });
    expect(seoMonitorRuleOf(seoMonitorWhen(never, "UTC"))).toEqual(never);
  });

  it("starts a new schedule on the repeat its opener chose, as a rule Core takes", () => {
    const weekly = seoMonitorWhen(null, "UTC");
    expect(weekly.repeat).toBe("weekly");
    expect(seoMonitorRuleOf(weekly)?.expr).toBe("0 9 * * MON");
    // The editor must read the preset as a monthly rule: a rule it cannot read would save nothing.
    const monthly = seoMonitorWhen(null, "UTC", undefined, "monthly");
    expect(monthly.repeat).toBe("monthly");
    expect(seoMonitorRuleOf(monthly)?.expr).toBe("0 9 1 * *");
  });

  it("opens a Monday-to-Friday rule as weekly with five days, since the SEO editor has no weekdays choice", () => {
    const when = seoMonitorWhen(rule({ expr: "0 9 * * MON-FRI" }), "UTC");
    expect(when.repeat).toBe("weekly");
    expect(seoMonitorRuleOf(when)?.expr).toBe("0 9 * * MON,TUE,WED,THU,FRI");
  });

  it("refuses a rule Core would refuse", () => {
    const when = seoMonitorWhen(rule(), "UTC");
    expect(seoMonitorRuleOf({ ...when, weekdays: [] })).toBeNull();
    expect(seoMonitorRuleOf({ ...when, endAfterOccurrences: 32 })).toBeNull();
    expect(seoMonitorRuleOf({ ...when, endAfterOccurrences: 0 })).toBeNull();
    expect(
      seoMonitorRuleOf({ ...when, endsMode: TaskScheduleEndsMode.ON }),
    ).toBeNull();
    expect(seoMonitorRuleOf({ ...when, repeat: "custom" })).toBeNull();
  });

  it("keeps an edit from ending the monitor at or before the runs it already made", () => {
    expect(seoMonitorRuleBelowReleased(rule({ targetRunCount: 2 }), 2)).toBe(
      true,
    );
    expect(seoMonitorRuleBelowReleased(rule({ targetRunCount: 3 }), 2)).toBe(
      false,
    );
    expect(
      seoMonitorRuleBelowReleased(
        rule({ endsMode: "NEVER", targetRunCount: null }),
        20,
      ),
    ).toBe(false);
  });
});
