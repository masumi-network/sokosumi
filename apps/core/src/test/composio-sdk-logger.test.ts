import {
  type ComposioLogger,
  logger as composioSdkLogger,
} from "@composio/core";
import { describe, expect, it, vi } from "vitest";

import { captureComposioSdkLogger } from "./composio-sdk-logger";

function fakeSink(): ComposioLogger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

describe("captureComposioSdkLogger", () => {
  it("puts back the sink and level an earlier file left, not console", () => {
    const restoreFileStart = captureComposioSdkLogger();
    const earlier = fakeSink();
    composioSdkLogger.configure({ level: "warn", sink: earlier });

    const restore = captureComposioSdkLogger();
    const later = fakeSink();
    composioSdkLogger.configure({ level: "debug", sink: later });
    restore();

    composioSdkLogger.info("dropped below warn");
    composioSdkLogger.warn("kept");
    restoreFileStart();

    expect(composioSdkLogger.getLevel()).not.toBe("debug");
    expect(later.warn).not.toHaveBeenCalled();
    expect(earlier.info).not.toHaveBeenCalled();
    expect(earlier.warn).toHaveBeenCalledWith(expect.stringContaining("kept"));
  });
});
