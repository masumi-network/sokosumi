import { describe, expect, it } from "vitest";

import { parseOpenGraphFields, toUnfurlCard } from "@/lib/open-graph-html";

describe("parseOpenGraphFields", () => {
  it("reads og meta tags", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Hello &amp; World">
        <meta property="og:description" content="A desc">
        <meta property="og:image" content="/og.png">
        <meta property="og:site_name" content="Example">
      </head></html>
    `;
    expect(parseOpenGraphFields(html)).toEqual({
      title: "Hello & World",
      description: "A desc",
      image: "/og.png",
      siteName: "Example",
    });
  });

  it("falls back to twitter meta and title element", () => {
    const html = `
      <html><head>
        <meta name="twitter:title" content="Tw Title">
        <meta name="twitter:description" content="Tw Desc">
        <meta name="twitter:image" content="https://cdn.example/t.png">
        <title>Page Title</title>
      </head></html>
    `;
    expect(parseOpenGraphFields(html)).toEqual({
      title: "Tw Title",
      description: "Tw Desc",
      image: "https://cdn.example/t.png",
      siteName: null,
    });
  });

  it("uses <title> when no og/twitter title", () => {
    expect(parseOpenGraphFields(`<title>Only Title</title>`).title).toBe(
      "Only Title",
    );
  });

  it("ignores YouTube bot-interstitial placeholder title", () => {
    expect(
      parseOpenGraphFields(
        `<html><head><title> - YouTube</title></head></html>`,
      ).title,
    ).toBeNull();
  });
});

describe("toUnfurlCard", () => {
  it("returns null when title exists but image and description are missing", () => {
    expect(
      toUnfurlCard(
        {
          title: "Sign In | Sentry",
          description: null,
          image: null,
          siteName: "Sentry",
        },
        "https://masumi.sentry.io",
        "https://masumi.sentry.io",
      ),
    ).toBeNull();

    expect(
      toUnfurlCard(
        {
          title: "Resend",
          description: "  ",
          image: null,
          siteName: "Resend",
        },
        "https://resend.com",
        "https://resend.com",
      ),
    ).toBeNull();
  });

  it("requires a non-empty title", () => {
    expect(
      toUnfurlCard(
        {
          title: null,
          description: "d",
          image: "https://cdn.example/i.png",
          siteName: "S",
        },
        "https://example.com/page",
        "https://example.com/page",
      ),
    ).toBeNull();

    expect(
      toUnfurlCard(
        {
          title: "  ",
          description: null,
          image: null,
          siteName: null,
        },
        "https://example.com/page",
        "https://example.com/page",
      ),
    ).toBeNull();
  });

  it("resolves relative images and drops non-http(s)", () => {
    expect(
      toUnfurlCard(
        {
          title: "T",
          description: "D",
          image: "/img.png",
          siteName: "Site",
        },
        "https://example.com/page",
        "https://example.com/page",
      ),
    ).toEqual({
      url: "https://example.com/page",
      title: "T",
      description: "D",
      imageUrl: "https://example.com/img.png",
      siteName: "Site",
    });

    expect(
      toUnfurlCard(
        {
          title: "T",
          description: "D",
          image: "data:image/png;base64,xxx",
          siteName: null,
        },
        "https://example.com/page",
        "https://example.com/page",
      ),
    ).toEqual({
      url: "https://example.com/page",
      title: "T",
      description: "D",
      imageUrl: null,
      siteName: "example.com",
    });
  });

  it("keeps a card with a description and no image", () => {
    expect(
      toUnfurlCard(
        {
          title: "Resend",
          description: "Email for developers",
          image: null,
          siteName: "Resend",
        },
        "https://resend.com",
        "https://resend.com",
      ),
    ).toEqual({
      url: "https://resend.com",
      title: "Resend",
      description: "Email for developers",
      imageUrl: null,
      siteName: "Resend",
    });
  });

  it("keeps a card with an image and no description", () => {
    expect(
      toUnfurlCard(
        {
          title: "Watch",
          description: null,
          image: "https://cdn.example/thumb.jpg",
          siteName: "YouTube",
        },
        "https://youtube.com/watch?v=1",
        "https://youtube.com/watch?v=1",
      ),
    ).toEqual({
      url: "https://youtube.com/watch?v=1",
      title: "Watch",
      description: null,
      imageUrl: "https://cdn.example/thumb.jpg",
      siteName: "YouTube",
    });
  });

  it("falls back to hostname when og:site_name is missing", () => {
    expect(
      toUnfurlCard(
        {
          title: "Example Domain",
          description: "Example description",
          image: null,
          siteName: null,
        },
        "https://example.com/",
        "https://example.com/",
      )?.siteName,
    ).toBe("example.com");

    expect(
      toUnfurlCard(
        {
          title: "T",
          description: "D",
          image: null,
          siteName: "  ",
        },
        "https://requested.example/a",
        "https://final.example/b",
      )?.siteName,
    ).toBe("final.example");
  });
});
