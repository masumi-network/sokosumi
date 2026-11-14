import { describe, expect, it, vi } from "vitest";
import { runWebEvidenceTool } from "./web-evidence-tool";

describe("runWebEvidenceTool", () => {
  it("returns exactly the structured evidence reported for the sandbox model", async () => {
    const report = vi.fn().mockResolvedValue(undefined);
    const result = await runWebEvidenceTool({
      run: async () => ({ text: `${"a".repeat(9000)} Price EUR24/month.` }),
      sources: () => ["https://example.com/pricing"],
      report,
    });
    const [status, output, sources] = report.mock.calls[0];
    expect(status).toBe("completed");
    expect(JSON.parse(output)).toEqual(result);
    expect(sources).toEqual(result.sources);
    expect(result.evidence.truncated).toBe(true);
    expect(output).not.toContain("EUR24");
  });

  it("does not expose credentials through successful results or errors", async () => {
    const report = vi.fn().mockResolvedValue(undefined);
    const result = await runWebEvidenceTool({
      run: async () => ({
        api_key: "synthetic-test-secret-only",
        text: "Public price EUR24.",
      }),
      sources: () => [],
      report,
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-test-secret-only");
    expect(JSON.stringify(report.mock.calls)).not.toContain(
      "synthetic-test-secret-only",
    );
    await expect(
      runWebEvidenceTool({
        run: async () => {
          throw new Error("password=synthetic-test-secret-only");
        },
        sources: () => [],
        report,
      }),
    ).rejects.not.toThrow("synthetic-test-secret-only");
    expect(JSON.stringify(report.mock.calls)).not.toContain(
      "synthetic-test-secret-only",
    );
  });

  it("does not return evidence to the model when its audit cannot be recorded", async () => {
    const report = vi
      .fn()
      .mockRejectedValueOnce(new Error("Audit unavailable"))
      .mockResolvedValue(undefined);
    await expect(
      runWebEvidenceTool({
        run: async () => ({ text: "Price EUR24." }),
        sources: () => [],
        report,
      }),
    ).rejects.toThrow("Audit unavailable");
    expect(report.mock.calls.map(([status]) => status)).toEqual([
      "completed",
      "failed",
    ]);
  });

  it("redacts errors when both audit reports fail", async () => {
    const report = vi.fn().mockRejectedValue(
      Object.assign(new Error("password=synthetic-test-secret-only"), {
        name: "token=synthetic-error-name-only",
      }),
    );
    const failure = await runWebEvidenceTool({
      run: async () => ({ text: "Price EUR24." }),
      sources: () => [],
      report,
    }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("synthetic-test-secret-only");
    expect(String(failure)).not.toContain("synthetic-error-name-only");
    expect(report).toHaveBeenCalledTimes(2);
  });
});
