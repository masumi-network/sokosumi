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

  it("verifies a created ad campaign only when it came back paused with an id", () => {
    expect(EXTERNAL_EFFECT_CAPABILITIES.has("create_ad_campaign")).toBe(true);
    expect(
      externalActionReceipt("create_ad_campaign", {
        campaignId: "123",
        status: "PAUSED",
      }),
    ).toEqual({
      targetId: "123",
      disposition: "APPLIED",
      verification: "PROVIDER_ACK",
      committedAt: expect.any(Date),
    });
    for (const result of [
      { campaignId: "123", status: "ENABLED" },
      { campaignId: "abc", status: "PAUSED" },
      { campaignId: "", status: "PAUSED" },
      { status: "PAUSED" },
    ])
      expect(externalActionReceipt("create_ad_campaign", result)).toMatchObject(
        { targetId: null, disposition: "UNKNOWN", verification: "NONE" },
      );
  });

  it.each([
    ["update_ad_campaign", "updated"],
    ["edit_ad_campaign", "edited"],
  ])(
    "verifies %s only on a campaign id and its done flag",
    (capability, flag) => {
      expect(EXTERNAL_EFFECT_CAPABILITIES.has(capability)).toBe(true);
      expect(
        externalActionReceipt(capability, { campaignId: "123", [flag]: true }),
      ).toEqual({
        targetId: "123",
        disposition: "APPLIED",
        verification: "PROVIDER_ACK",
        committedAt: expect.any(Date),
      });
      for (const result of [
        { campaignId: "123", [flag]: false },
        { campaignId: "123" },
        { campaignId: "abc", [flag]: true },
        { [flag]: true },
      ])
        expect(externalActionReceipt(capability, result)).toMatchObject({
          targetId: null,
          disposition: "UNKNOWN",
          verification: "NONE",
        });
    },
  );

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
  it("acknowledges an upload by its file id, never a public blob URL", () => {
    expect(
      externalActionReceipt("upload_file", {
        id: "01a0f400-0000-7000-8000-000000000001",
        filename: "synthetic.md",
        link: "/drive/files/01a0f400-0000-7000-8000-000000000001",
        size: 4,
      }),
    ).toMatchObject({
      disposition: "APPLIED",
      targetId: "01a0f400-0000-7000-8000-000000000001",
    });
    expect(
      externalActionReceipt("upload_file", {
        url: "https://blob.example/synthetic",
        filename: "synthetic.md",
        size: 4,
      }).disposition,
    ).toBe("UNKNOWN");
    expect(
      externalActionReceipt("upload_file", {
        id: null,
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

  it("treats a video job exactly like an image job", () => {
    expect(
      externalActionReceipt("generate_video", {
        jobId: "job-v",
        status: "QUEUED",
      }),
    ).toMatchObject({ targetId: "job-v", disposition: "APPLIED" });
    expect(
      externalActionReceipt("generate_video", { status: "FAILED" }),
    ).toMatchObject({ disposition: "REJECTED" });
    expect(
      externalActionReceipt("generate_video", {
        jobId: "job-v",
        status: "SUBMISSION_UNCERTAIN",
      }),
    ).toMatchObject({ disposition: "UNKNOWN" });
  });
});
