import { describe, expect, it } from "vitest";
import {
  ACTION_CAPABILITIES,
  actionInputHash,
  EXTERNAL_EFFECT_CAPABILITIES,
  externalActionReceipt,
} from "./action-receipts";

describe("external action receipts", () => {
  it("classifies social mutations separately from authorized reads", () => {
    for (const capability of [
      "create_social_post",
      "update_social_post",
      "schedule_social_post",
      "cancel_social_post",
    ]) {
      expect(ACTION_CAPABILITIES.has(capability)).toBe(true);
      expect(EXTERNAL_EFFECT_CAPABILITIES.has(capability)).toBe(false);
    }
    expect(ACTION_CAPABILITIES.has("publish_social_post")).toBe(true);
    expect(EXTERNAL_EFFECT_CAPABILITIES.has("publish_social_post")).toBe(true);
    for (const capability of [
      "list_project_social_accounts",
      "list_social_posts",
      "get_social_post",
    ]) {
      expect(ACTION_CAPABILITIES.has(capability)).toBe(false);
    }
  });

  it("requires a provider publication identity before verifying social publication", () => {
    expect(
      externalActionReceipt("publish_social_post", {
        id: "post-one",
        status: "PUBLISHED",
        publishedExternalId: "provider-post-one",
      }),
    ).toEqual({
      targetId: "post-one",
      disposition: "APPLIED",
      verification: "PROVIDER_ACK",
      committedAt: expect.any(Date),
    });
  });

  it.each([
    { status: "PUBLISHING" },
    { status: "FAILED" },
    { status: "SCHEDULED" },
    { publishedExternalId: null },
    { publishedExternalId: "" },
    { publishedExternalId: "   " },
    { id: "" },
    { id: "   " },
  ])("keeps uncertain publication unknown: %j", (change) => {
    expect(
      externalActionReceipt("publish_social_post", {
        id: "post-one",
        status: "PUBLISHED",
        publishedExternalId: "provider-post-one",
        publishedUrl: "https://social.example/posts/one",
        ...change,
      }),
    ).toEqual({
      targetId: null,
      disposition: "UNKNOWN",
      verification: "NONE",
      committedAt: null,
    });
  });

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

describe("image receipts", () => {
  it("acknowledges an image job the provider took", () => {
    expect(
      externalActionReceipt("generate_image", {
        jobId: "job-1",
        status: "QUEUED",
      }),
    ).toMatchObject({
      targetId: "job-1",
      disposition: "APPLIED",
      verification: "PROVIDER_ACK",
    });
  });

  it("leaves an uncertain submission unknown", () => {
    expect(
      externalActionReceipt("generate_image", {
        jobId: "job-1",
        status: "SUBMISSION_UNCERTAIN",
      }),
    ).toMatchObject({ targetId: null, disposition: "UNKNOWN" });
  });
});
