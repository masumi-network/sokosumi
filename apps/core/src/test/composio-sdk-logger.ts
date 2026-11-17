import { logger as composioSdkLogger } from "@composio/core";
import { afterAll } from "vitest";

/**
 * Composio's SDK logger is process-wide, so a client built in one file keeps
 * logging through it in the next file of the same unit worker. Returns a
 * function that puts back the level and sink found now.
 */
export function captureComposioSdkLogger(): () => void {
  const level = composioSdkLogger.getLevel();
  // shortcut: @composio/core 0.29.0 has no getter for its sink, so this reads
  // the private field; use the getter once the SDK has one.
  const sink: unknown = Reflect.get(composioSdkLogger, "sink");
  if (typeof sink !== "object" || sink === null) {
    throw new Error("Composio's SDK logger no longer has a `sink` field");
  }
  return () =>
    composioSdkLogger.configure({
      level,
      sink: sink as Parameters<typeof composioSdkLogger.configure>[0]["sink"],
    });
}

/** For a file that configures the SDK logger: restores it after the file. */
export function restoreComposioSdkLoggerAfterFile(): void {
  afterAll(captureComposioSdkLogger());
}
