import { describe, expect, it } from "vitest";

import {
  isUsersnapWidgetLoadFailure,
  USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE,
} from "../usersnap-errors";

describe("isUsersnapWidgetLoadFailure", () => {
  it("returns true for the Usersnap string rejection", () => {
    expect(
      isUsersnapWidgetLoadFailure(USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE),
    ).toBe(true);
  });

  it("returns true for Error instances with the Usersnap message", () => {
    expect(
      isUsersnapWidgetLoadFailure(
        new Error(USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated rejections", () => {
    expect(isUsersnapWidgetLoadFailure("Network request failed")).toBe(false);
    expect(
      isUsersnapWidgetLoadFailure(new Error("Network request failed")),
    ).toBe(false);
    expect(isUsersnapWidgetLoadFailure(null)).toBe(false);
  });
});
