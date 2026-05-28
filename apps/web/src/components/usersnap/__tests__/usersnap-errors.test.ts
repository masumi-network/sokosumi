import { describe, expect, it } from "vitest";

import {
  isUsersnapWidgetLoadFailure,
  USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE,
} from "@/components/usersnap/usersnap-errors";

describe("isUsersnapWidgetLoadFailure", () => {
  it("matches the Usersnap string rejection message", () => {
    expect(
      isUsersnapWidgetLoadFailure(USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE),
    ).toBe(true);
  });

  it("matches Error instances with the Usersnap message", () => {
    expect(
      isUsersnapWidgetLoadFailure(
        new Error(USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated values", () => {
    expect(isUsersnapWidgetLoadFailure("network error")).toBe(false);
    expect(isUsersnapWidgetLoadFailure(null)).toBe(false);
    expect(isUsersnapWidgetLoadFailure(new Error("other"))).toBe(false);
  });
});
