import { isUrlSupported } from "@ai-sdk/provider-utils";
import { describe, expect, it } from "vitest";

import { createSokosumiLanguageModel } from "./sokosumi-language-model.js";

describe("SokosumiLanguageModel supportedUrls", () => {
  it("exposes LanguageModelV4 specificationVersion", () => {
    const model = createSokosumiLanguageModel("openai/gpt-5.4", {
      openRouterApiKey: "sk-or-test",
    });
    expect(model.specificationVersion).toBe("v4");
  });

  it("passes through public file and image URLs without SDK pre-downloads", async () => {
    const model = createSokosumiLanguageModel("openai/gpt-5.4", {
      openRouterApiKey: "sk-or-test",
    });
    const supportedUrls = await Promise.resolve(model.supportedUrls);

    expect(
      isUrlSupported({
        url: "https://example.com/brief.pdf",
        mediaType: "application/pdf",
        supportedUrls,
      }),
    ).toBe(true);
    expect(
      isUrlSupported({
        url: "https://example.com/image.png",
        mediaType: "image/png",
        supportedUrls,
      }),
    ).toBe(true);
    expect(
      isUrlSupported({
        url: "data:image/png;base64,iVBORw0KGgo=",
        mediaType: "image/png",
        supportedUrls,
      }),
    ).toBe(true);
    expect(
      isUrlSupported({
        url: "file:///tmp/brief.pdf",
        mediaType: "application/pdf",
        supportedUrls,
      }),
    ).toBe(false);
  });
});
