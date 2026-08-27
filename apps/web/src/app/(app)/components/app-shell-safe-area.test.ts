import { describe, expect, it } from "vitest";

import {
  APP_HEADER_SAFE_AREA_PADDING_CLASS,
  APP_HEADER_SAFE_AREA_UNDERLAY_CLASS,
  APP_MAIN_MOBILE_PT_CLASS,
  APP_SHELL_BELOW_HEADER_HEIGHT_CLASS,
  APP_SHELL_BELOW_HEADER_MAX_HEIGHT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS,
  APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS,
  AUTH_SHELL_SAFE_AREA_PADDING_CLASS,
} from "./app-shell-safe-area";

describe("app-shell-safe-area", () => {
  it("pads header for top/left/right cutouts under viewport-fit=cover", () => {
    expect(APP_HEADER_SAFE_AREA_PADDING_CLASS).toContain(
      "env(safe-area-inset-top)",
    );
    expect(APP_HEADER_SAFE_AREA_PADDING_CLASS).toContain(
      "env(safe-area-inset-left)",
    );
    expect(APP_HEADER_SAFE_AREA_PADDING_CLASS).toContain(
      "env(safe-area-inset-right)",
    );
  });

  it("paints opaque top underlay sized to safe-area inset", () => {
    expect(APP_HEADER_SAFE_AREA_UNDERLAY_CLASS).toContain(
      "env(safe-area-inset-top)",
    );
    expect(APP_HEADER_SAFE_AREA_UNDERLAY_CLASS).toContain("bg-background");
    expect(APP_HEADER_SAFE_AREA_UNDERLAY_CLASS).toContain("absolute");
    expect(APP_HEADER_SAFE_AREA_UNDERLAY_CLASS).toContain("md:hidden");
  });

  it("extends former pt-20 main offset by top safe-area", () => {
    expect(APP_MAIN_MOBILE_PT_CLASS).toBe(
      "pt-[calc(5rem+env(safe-area-inset-top))]",
    );
  });

  it("subtracts header row + top inset from svh shells", () => {
    expect(APP_SHELL_BELOW_HEADER_HEIGHT_CLASS).toBe(
      "h-[calc(100svh-4rem-env(safe-area-inset-top))]",
    );
    expect(APP_SHELL_BELOW_HEADER_MIN_HEIGHT_CLASS).toBe(
      "min-h-[calc(100svh-4rem-env(safe-area-inset-top))]",
    );
    expect(APP_SHELL_BELOW_HEADER_MAX_HEIGHT_CLASS).toBe(
      "max-h-[calc(100svh-4rem-env(safe-area-inset-top))]",
    );
  });

  it("uses the same below-header calc for sticky md main heights", () => {
    expect(APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS).toBe(
      "md:min-h-[calc(100svh-4rem-env(safe-area-inset-top))]",
    );
    expect(APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS).toBe(
      "md:max-h-[calc(100svh-4rem-env(safe-area-inset-top))]",
    );
  });

  it("keeps auth shell at least p-6 while clearing all insets", () => {
    expect(AUTH_SHELL_SAFE_AREA_PADDING_CLASS).toContain(
      "max(1.5rem,env(safe-area-inset-top))",
    );
    expect(AUTH_SHELL_SAFE_AREA_PADDING_CLASS).toContain(
      "max(1.5rem,env(safe-area-inset-bottom))",
    );
    expect(AUTH_SHELL_SAFE_AREA_PADDING_CLASS).toContain(
      "max(1.5rem,env(safe-area-inset-left))",
    );
    expect(AUTH_SHELL_SAFE_AREA_PADDING_CLASS).toContain(
      "max(1.5rem,env(safe-area-inset-right))",
    );
  });
});
