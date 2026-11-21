import { describe, expect, it } from "vitest";
import {
  TEST_COPY_LIFETIME_MS,
  TEST_COPY_SCHEDULE_FLOOR_MS,
} from "./project-test-copy";

const HOUR = 60 * 60 * 1_000;

describe("a test copy's lifetime", () => {
  it("lives long enough to make a month: six hours stopped NMKR's copy at 67 of 171", () => {
    expect(TEST_COPY_LIFETIME_MS).toBe(10 * HOUR);
  });

  it("keeps the 12-hour floor, so teardown comes two hours before any post is due", () => {
    expect(TEST_COPY_SCHEDULE_FLOOR_MS).toBe(12 * HOUR);
    // The production sync runs every 10 minutes and tears down an old copy.
    expect(
      TEST_COPY_SCHEDULE_FLOOR_MS - TEST_COPY_LIFETIME_MS,
    ).toBeGreaterThanOrEqual(2 * HOUR);
  });
});
