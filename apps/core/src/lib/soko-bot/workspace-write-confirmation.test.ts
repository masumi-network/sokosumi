import { describe, expect, it } from "vitest";
import { workspaceWriteConfirmations } from "./workspace-write-confirmation";

function call(overrides: Record<string, unknown> = {}) {
  return {
    capability: "workspace_write",
    status: "COMPLETED",
    input: { path: "totals.csv" },
    result: {
      output: JSON.stringify({ path: "totals.csv", bytes: 42 }),
      sources: [],
    },
    ...overrides,
  };
}

describe("workspace write confirmations", () => {
  it("accepts the persisted runner envelope, including an empty file", () => {
    expect(workspaceWriteConfirmations([call()])).toEqual([
      'Saved workspace file: `"totals.csv"`.',
    ]);
    expect(
      workspaceWriteConfirmations([
        call({
          result: {
            output: JSON.stringify({ path: "totals.csv", bytes: 0 }),
            sources: [],
          },
        }),
      ]),
    ).toHaveLength(1);
  });

  it.each([
    null,
    { path: "totals.csv", bytes: 42 },
    { output: '{"path":' },
    { output: "x".repeat(4_097) },
    { output: JSON.stringify({ path: "other.csv", bytes: 42 }) },
    ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "42", null].map((bytes) => ({
      output: JSON.stringify({ path: "totals.csv", bytes }),
    })),
  ])(
    "rejects malformed, clipped, mismatched, or invalid byte receipts: %j",
    (result) => {
      expect(workspaceWriteConfirmations([call({ result })])).toEqual([]);
    },
  );

  it.each(["FAILED", "PENDING"])(
    "does not reuse success after the latest %s attempt",
    (status) => {
      expect(workspaceWriteConfirmations([call(), call({ status })])).toEqual(
        [],
      );
      expect(
        workspaceWriteConfirmations([
          call(),
          call({ status, input: { path: "notes/../totals.csv" } }),
        ]),
      ).toEqual([]);
    },
  );

  it("confirms a retry once, without losing another successful path", () => {
    const other = call({
      input: { path: "notes.md" },
      result: {
        output: JSON.stringify({ path: "notes.md", bytes: 2 }),
        sources: [],
      },
    });
    expect(
      workspaceWriteConfirmations([
        call({ status: "FAILED" }),
        other,
        call(),
        call(),
      ]),
    ).toEqual([
      'Saved workspace file: `"totals.csv"`.',
      'Saved workspace file: `"notes.md"`.',
    ]);
  });

  it("renders filenames as bounded text rather than Markdown or new lines", () => {
    const path = "[click](https://example.test)\n`file`.csv";
    const result = workspaceWriteConfirmations([
      call({
        input: { path },
        result: { output: JSON.stringify({ path, bytes: 1 }) },
      }),
    ]);
    expect(result).toEqual([
      'Saved workspace file:\n```\n"[click](https://example.test)\\n`file`.csv"\n```',
    ]);
    expect(result[0].split("\n")).toHaveLength(4);
    expect(
      workspaceWriteConfirmations([call({ input: { path: "x".repeat(501) } })]),
    ).toEqual([]);
    expect(workspaceWriteConfirmations([call({ capability: "bash" })])).toEqual(
      [],
    );
  });
});
