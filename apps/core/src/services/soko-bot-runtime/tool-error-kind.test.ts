import {
  SOKO_BOT_FEATURE_OFF,
  SOKO_BOT_TOOL_REFUSED,
} from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import {
  SokoBotFeatureOffError,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { toolErrorKind } from "./execution";

describe("toolErrorKind", () => {
  it("stores a feature that is off, a refusal and other errors apart", () => {
    expect(toolErrorKind(new SokoBotFeatureOffError("off"))).toBe(
      SOKO_BOT_FEATURE_OFF,
    );
    expect(toolErrorKind(new SokoBotRefusedUnsentError("no"))).toBe(
      SOKO_BOT_TOOL_REFUSED,
    );
    expect(toolErrorKind(new SokoBotRuntimeValidationError("bad input"))).toBe(
      "Error",
    );
    expect(toolErrorKind("thrown text")).toBe("unknown");
  });
});
