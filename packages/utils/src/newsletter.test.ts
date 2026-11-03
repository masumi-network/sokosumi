import { describe, expect, it } from "vitest";

import {
  newsletterBrandSchema,
  newsletterContentSchema,
  newsletterSignupLinks,
} from "./newsletter.js";

describe("newsletter content", () => {
  it("accepts every block and simple formatting as plain input", () => {
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
      {
        type: "image",
        url: "https://example.com/small.png",
        alt: "Small",
        width: 50,
        align: "center",
      },
      {
        type: "columns",
        columns: [
          { text: "Left", imageUrl: "https://example.com/a.png", alt: "A" },
          { text: "Right" },
        ],
      },
      { type: "spacer", size: "lg" },
      {
        type: "social",
        links: [
          { network: "linkedin", url: "https://linkedin.com/company/x" },
          { network: "website", url: "https://example.com" },
        ],
      },
      { type: "footer", text: "You get this because you signed up." },
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
    { type: "image", url: "https://example.com/a.png", alt: "", width: 5 },
    { type: "image", url: "https://example.com/a.png", alt: "", align: "top" },
    { type: "columns", columns: [{ text: "Only one" }] },
    {
      type: "columns",
      columns: [
        { text: "A", imageUrl: "http://example.com/a.png" },
        { text: "B" },
      ],
    },
    { type: "spacer", size: "xl" },
    { type: "social", links: [] },
    { type: "social", links: [{ network: "myspace", url: "https://a.com" }] },
    { type: "social", links: [{ network: "x", url: "javascript:alert(1)" }] },
  ])("rejects invalid blocks and non-HTTPS URLs: %j", (block) => {
    expect(newsletterContentSchema.safeParse([block]).success).toBe(false);
  });
});

describe("newsletter brand", () => {
  it("keeps a design saved before the studio fields existed", () => {
    expect(
      newsletterBrandSchema.parse({ fontFamily: "Arial", footerText: "" }),
    ).toEqual({ fontFamily: "Arial", footerText: "" });
  });

  it("accepts the studio design fields", () => {
    const brand = {
      backgroundColor: "#f4f4f4",
      buttonTextColor: "#000",
      buttonShape: "pill",
      headerImageUrl: "https://example.com/banner.png",
      headerAlign: "center",
      spacing: "roomy",
    };
    expect(newsletterBrandSchema.parse(brand)).toEqual(brand);
  });

  it("keeps optional signup overrides separate from the shared design", () => {
    const brand = {
      accentColor: "#123456",
      buttonShape: "rounded",
      signupForm: {
        accentColor: "#abcdef",
        buttonTextColor: "#000",
        buttonShape: "pill",
        headerAlign: "center",
        spacing: "compact",
      },
    };
    expect(newsletterBrandSchema.parse(brand)).toEqual(brand);
    expect(newsletterBrandSchema.parse({ signupForm: {} })).toEqual({
      signupForm: {},
    });
  });

  it.each([
    { backgroundColor: "red" },
    { buttonShape: "circle" },
    { headerImageUrl: "http://example.com/banner.png" },
    { spacing: "huge" },
    { signupForm: { accentColor: "red" } },
    { signupForm: { buttonTextColor: "url(https://example.com)" } },
    { signupForm: { buttonShape: "circle" } },
    { signupForm: { headerAlign: "right" } },
    { signupForm: { spacing: "huge" } },
  ])("rejects an invalid design field: %j", (brand) => {
    expect(newsletterBrandSchema.safeParse(brand).success).toBe(false);
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
