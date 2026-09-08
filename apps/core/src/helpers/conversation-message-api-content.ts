function readEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Reads persisted `metadata.thought_timing_ms` for API clients. */
export function thoughtTimingFromMessageMetadata(metadata: unknown):
  | {
      startedAtMs: number;
      endedAtMs: number;
    }
  | undefined {
  const meta = metadata as {
    thought_timing_ms?: { start?: unknown; end?: unknown };
  } | null;
  const t = meta?.thought_timing_ms;
  if (!t) {
    return undefined;
  }
  const start = readEpochMs(t.start);
  const end = readEpochMs(t.end);
  if (start != null && end != null && end >= start) {
    return { startedAtMs: start, endedAtMs: end };
  }
  return undefined;
}

export function imageGenerationFromMessageMetadata(metadata: unknown): boolean {
  const meta = metadata as { image_generation?: unknown } | null;
  return meta?.image_generation === true;
}
