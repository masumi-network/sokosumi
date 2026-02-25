import { getBucketKeyFromMetadata } from "../bucket-slug";

describe("getBucketKeyFromMetadata", () => {
  it("returns coworker bucket when only coworker_slug is present", () => {
    expect(
      getBucketKeyFromMetadata({
        type: "coworker",
        coworker_slug: "hannah",
      }),
    ).toBe("coworker:hannah");
  });

  it("prefers coworker_slug over coworker_id", () => {
    expect(
      getBucketKeyFromMetadata({
        type: "coworker",
        coworker_id: "7f5de96e-245f-4f4a-8566-cad4e4f64a48",
        coworker_slug: "elena",
      }),
    ).toBe("coworker:elena");
  });

  it("keeps coworker bucket when coworker metadata and model_id coexist", () => {
    expect(
      getBucketKeyFromMetadata({
        type: "coworker",
        coworker_id: "hannah",
        model_id: "openai/gpt-5",
      }),
    ).toBe("coworker:hannah");
  });

  it("returns model bucket for model chats", () => {
    expect(
      getBucketKeyFromMetadata({
        type: "model",
        model_id: "anthropic/claude-sonnet-4",
      }),
    ).toBe("model:anthropic/claude-sonnet-4");
  });
});
