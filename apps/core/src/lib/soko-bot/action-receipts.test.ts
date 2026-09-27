import { describe, expect, it } from "vitest";
import { actionInputHash, externalActionReceipt } from "./action-receipts";

describe("external action receipts", () => {
  it("deduplicates reordered nested JSON keys while preserving array order and values", () => {
    expect(actionInputHash({ taskId: "one", payload: { a: 1, b: 2 } })).toBe(
      actionInputHash({ payload: { b: 2, a: 1 }, taskId: "one" }),
    );
    expect(actionInputHash({ a: 1, omitted: undefined })).toBe(
      actionInputHash({ a: 1 }),
    );
    expect(actionInputHash([1, 2])).not.toBe(actionInputHash([2, 1]));
    expect(actionInputHash({ a: 1 })).not.toBe(actionInputHash({ a: 2 }));
  });
  it("accepts only explicit successful decision acknowledgments", () => {
    expect(
      externalActionReceipt("hire_agent", {
        executed: true,
        status: "ACCEPTED",
        resultingEntityId: "job-one",
      }),
    ).toMatchObject({
      targetId: "job-one",
      disposition: "APPLIED",
      verification: "PROVIDER_ACK",
    });
    expect(
      externalActionReceipt("provide_job_input", {
        executed: false,
        status: "PROCESSING",
        resultingEntityId: "input-one",
      }).disposition,
    ).toBe("UNKNOWN");
  });
  it("does not infer business success from an integration payload", () => {
    expect(
      externalActionReceipt("run_integration_tool", {
        executed: true,
        status: "ACCEPTED",
        resultingEntityId: "synthetic",
      }),
    ).toMatchObject({
      disposition: "UNKNOWN",
      verification: "NONE",
      committedAt: null,
    });
  });
  it("accepts uploaded HTTPS blob acknowledgement but rejects malformed results", () => {
    expect(
      externalActionReceipt("upload_file", {
        url: "https://blob.example/synthetic",
        filename: "synthetic.md",
        size: 4,
      }).disposition,
    ).toBe("APPLIED");
    expect(
      externalActionReceipt("upload_file", {
        url: "javascript:bad",
        filename: "synthetic.md",
        size: 4,
      }).disposition,
    ).toBe("UNKNOWN");
  });
});
