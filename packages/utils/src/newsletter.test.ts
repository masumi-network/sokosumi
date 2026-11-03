import { describe, expect, it } from "vitest";

import {
  newsletterContentSchema,
  newsletterSignupLinks,
} from "./newsletter.js";

describe("newsletter content", () => {
  it("accepts the five blocks and simple formatting as plain input", () => {
    const blocks = [
      { type: "heading", text: "News", level: 1 },
      { type: "text", text: "**Hello**\n\n[Read](https://example.com)" },
      {
        type: "image",
        url: "https://example.com/image.png",
        alt: "Image",
        href: "https://example.com",
      },
      { type: "button", label: "Read", url: "https://example.com" },
      { type: "divider" },
    ];
    expect(newsletterContentSchema.parse(blocks)).toEqual(blocks);
  });

  it.each([
    { type: "heading", text: "News", level: 3 },
    { type: "image", url: "http://example.com/image.png", alt: "Image" },
    {
      type: "image",
      url: "https://example.com/image.png",
      alt: "Image",
      href: "javascript:alert(1)",
    },
    { type: "button", label: "Read", url: "javascript:alert(1)" },
    { type: "html", html: "<script>bad</script>" },
  ])("rejects invalid blocks and non-HTTPS URLs: %j", (block) => {
    expect(newsletterContentSchema.safeParse([block]).success).toBe(false);
  });
});

describe("newsletter signup links", () => {
  it("encodes the slug in the signup page, archive and embed", () => {
    expect(
      newsletterSignupLinks('news/"&', "https://app.example.com", "Signup"),
    ).toEqual({
      signupUrl: "https://app.example.com/n/news%2F%22%26",
      archiveUrl: "https://app.example.com/n/news%2F%22%26/archive",
      embedHtml:
        '<iframe src="https://app.example.com/n/news%2F%22%26/embed" title="Signup" width="100%" height="440" style="border:0;background:transparent;" loading="lazy"></iframe>',
    });
  });
});
