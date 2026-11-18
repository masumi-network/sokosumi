import { beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ ssrfSafeFetch: vi.fn() }));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: net.ssrfSafeFetch }));

import { pricingLink, profileHandle, readCompetitorPage } from "./page-read";

const filler = Array.from(
  { length: 12 },
  (_unused, index) => `<p>Statement number ${index} about scheduling.</p>`,
).join("");

function html(body: string) {
  return new Response(`<html><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

beforeEach(() => {
  net.ssrfSafeFetch.mockReset();
});

describe("readCompetitorPage", () => {
  it("keeps what both reads show and says who is reading", async () => {
    net.ssrfSafeFetch
      .mockResolvedValueOnce(html(`${filler}<p>"Saved us hours" Ana</p>`))
      .mockResolvedValueOnce(html(`${filler}<p>"Love it" Ben</p>`));
    const page = await readCompetitorPage("https://calendly.com/");
    expect(page?.lines).toHaveLength(12);
    expect(page?.lines.join(" ")).not.toContain("Saved us hours");
    const [, init] = net.ssrfSafeFetch.mock.calls[0] ?? [];
    expect(init.headers["User-Agent"]).toContain("+https://cmo.xyz");
    expect(init.maxResponseBytes).toBeGreaterThan(0);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports where a redirect ended", async () => {
    net.ssrfSafeFetch.mockImplementation(async (_url, init) => {
      init.onFinalUrl("https://calendly.com/pricing");
      return html(filler);
    });
    const page = await readCompetitorPage("https://calendly.com/plans");
    expect(page?.url).toBe("https://calendly.com/pricing");
  });

  it.each([
    ["an error page", () => new Response("nope", { status: 403 })],
    [
      "a file that is not HTML",
      () =>
        new Response("%PDF", {
          headers: { "content-type": "application/pdf" },
        }),
    ],
    ["a page with almost no text", () => html("<div id='root'></div>")],
  ])("reads nothing from %s", async (_label, response) => {
    net.ssrfSafeFetch.mockImplementation(async () => response());
    expect(await readCompetitorPage("https://calendly.com/")).toBeNull();
  });
});

describe("pricingLink", () => {
  it("finds the pricing page the homepage links to", () => {
    expect(
      pricingLink(
        '<a href="/about">About</a><a href="/pricing?ref=nav#plans">Pricing</a>',
        "https://www.calendly.com/",
      ),
    ).toBe("https://www.calendly.com/pricing");
  });

  it("reads other words for it", () => {
    expect(
      pricingLink('<a href="/de/preise/">Preise</a>', "https://x.de/"),
    ).toBe("https://x.de/de/preise/");
    expect(pricingLink('<a href="/plans">Plans</a>', "https://x.com/")).toBe(
      "https://x.com/plans",
    );
  });

  it("ignores another site's pricing and pages that only mention it", () => {
    expect(
      pricingLink(
        '<a href="https://other.com/pricing">x</a><a href="/blog/pricing-strategy-guide/part-2">y</a>',
        "https://calendly.com/",
      ),
    ).toBeNull();
  });
});

describe("profileHandle", () => {
  const footer =
    '<a href="https://www.instagram.com/p/abc123/">Post</a><a href="https://www.instagram.com/BlueBottle/">IG</a><a href="https://facebook.com/sharer/sharer.php?u=x">Share</a><a href="https://www.facebook.com/bluebottlecoffee">FB</a>';

  it("reads the account, not a post or a share link", () => {
    expect(profileHandle(footer, "instagram.com")).toBe("bluebottle");
    expect(profileHandle(footer, "facebook.com")).toBe("bluebottlecoffee");
  });

  it("is empty when the page links none", () => {
    expect(
      profileHandle("<a href='/about'>About</a>", "instagram.com"),
    ).toBeNull();
  });
});
