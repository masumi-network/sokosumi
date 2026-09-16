import { beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import { scrapeOneUnfurlCard } from "./chat-unfurl-scrape";

const X_STATUS_URL = "https://x.com/Payward/status/2100178016617869710?s=20";

/** What x.com serves to link-preview bots: title + image, empty description. */
const X_STATUS_HTML = `<html><head>
<meta property="og:site_name" content="X (formerly Twitter)"/>
<meta property="og:title" content="Payward (@Payward) on X"/>
<meta content="" property="og:description"/>
<meta content="https://jf.x.com/images/post/2100178016617869710.png" property="og:image"/>
</head></html>`;

/** Real publish.x.com/oembed payload for that status (trimmed). */
const X_OEMBED_JSON = JSON.stringify({
  url: "https://x.com/Payward/status/2100178016617869710",
  author_name: "Payward",
  html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Payward 🤝 <a href="https://x.com/HyperliquidX?ref_src=twsrc%5Etfw">@HyperliquidX</a><br><br>We&#39;re building permissioned Hyperliquid HIP-3* markets for US clients. <a href="https://t.co/D9WwRgVaK0">pic.twitter.com/D9WwRgVaK0</a></p>&mdash; Payward (@Payward) <a href="https://x.com/Payward/status/2100178016617869710?ref_src=twsrc%5Etfw">September 16, 2026</a></blockquote>\n',
});

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("scrapeOneUnfurlCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fills an X status card's empty description with the tweet text from oEmbed", async () => {
    ssrfSafeFetchMock.mockImplementation(async (url: string) =>
      url.startsWith("https://publish.x.com/oembed?")
        ? jsonResponse(X_OEMBED_JSON)
        : htmlResponse(X_STATUS_HTML),
    );

    const card = await scrapeOneUnfurlCard(X_STATUS_URL);

    expect(card).toEqual({
      url: X_STATUS_URL,
      title: "Payward (@Payward) on X",
      description:
        "Payward 🤝 @HyperliquidX\n\nWe're building permissioned Hyperliquid HIP-3* markets for US clients. pic.twitter.com/D9WwRgVaK0",
      imageUrl: "https://jf.x.com/images/post/2100178016617869710.png",
      siteName: "X (formerly Twitter)",
    });
    const oembedCall = ssrfSafeFetchMock.mock.calls.find(([url]) =>
      String(url).startsWith("https://publish.x.com/oembed?"),
    );
    expect(oembedCall).toBeDefined();
    expect(new URL(String(oembedCall?.[0])).searchParams.get("url")).toBe(
      "https://x.com/Payward/status/2100178016617869710",
    );
  });

  it("keeps the image-only card when oEmbed fails", async () => {
    ssrfSafeFetchMock.mockImplementation(async (url: string) =>
      url.startsWith("https://publish.x.com/oembed?")
        ? new Response("nope", { status: 429 })
        : htmlResponse(X_STATUS_HTML),
    );

    const card = await scrapeOneUnfurlCard(X_STATUS_URL);

    expect(card).toMatchObject({
      title: "Payward (@Payward) on X",
      description: null,
      imageUrl: "https://jf.x.com/images/post/2100178016617869710.png",
    });
  });

  it("keeps the image-only card when the oEmbed request throws", async () => {
    ssrfSafeFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("https://publish.x.com/oembed?")) {
        throw new Error("timeout");
      }
      return htmlResponse(X_STATUS_HTML);
    });

    const card = await scrapeOneUnfurlCard(X_STATUS_URL);

    expect(card?.description).toBeNull();
    expect(card?.imageUrl).toBe(
      "https://jf.x.com/images/post/2100178016617869710.png",
    );
  });

  it("does not call oEmbed for non-X pages with an empty description", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      htmlResponse(
        '<html><head><meta property="og:title" content="Example"><meta property="og:image" content="https://cdn.example/i.png"></head></html>',
      ),
    );

    const card = await scrapeOneUnfurlCard("https://example.com/post/1");

    expect(card).toMatchObject({ title: "Example", description: null });
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call oEmbed for X pages that already have a description", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      htmlResponse(
        '<html><head><meta property="og:title" content="Payward (@Payward) on X"><meta property="og:description" content="Already here"></head></html>',
      ),
    );

    const card = await scrapeOneUnfurlCard(X_STATUS_URL);

    expect(card?.description).toBe("Already here");
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes twitter.com status links for the oEmbed lookup", async () => {
    ssrfSafeFetchMock.mockImplementation(async (url: string) =>
      url.startsWith("https://publish.x.com/oembed?")
        ? jsonResponse(X_OEMBED_JSON)
        : htmlResponse(X_STATUS_HTML),
    );

    await scrapeOneUnfurlCard(
      "https://twitter.com/Payward/status/2100178016617869710?t=abc",
    );

    const oembedCall = ssrfSafeFetchMock.mock.calls.find(([url]) =>
      String(url).startsWith("https://publish.x.com/oembed?"),
    );
    expect(new URL(String(oembedCall?.[0])).searchParams.get("url")).toBe(
      "https://x.com/Payward/status/2100178016617869710",
    );
  });
});
