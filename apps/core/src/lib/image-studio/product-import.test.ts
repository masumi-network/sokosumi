import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWebsite, generateText, reserveResearch } = vi.hoisted(() => ({
  fetchWebsite: vi.fn(),
  generateText: vi.fn(),
  reserveResearch: vi.fn(),
}));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: fetchWebsite }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ AI_GATEWAY_API_KEY: "test" }),
}));
vi.mock("@/lib/redis", () => ({
  getRedisClient: () => ({ set: reserveResearch }),
}));

import { importStudioProducts } from "./product-import";

const STORE = "https://store.example.com";

function productPage(name: string) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name,
        description: "<p>A <b>small</b> vase &amp; tray.</p>",
        image: { contentUrl: "/media/vase.webp" },
        offers: { price: "12.90", priceCurrency: "EUR" },
      },
    ],
  })}</script>`;
}

describe("importStudioProducts", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads a product page and resolves relative photo URLs", async () => {
    fetchWebsite.mockResolvedValueOnce(new Response(productPage("Vase")));

    await expect(
      importStudioProducts(`${STORE}/products/vase`),
    ).resolves.toEqual([
      expect.objectContaining({
        name: "Vase",
        description: "A small vase & tray.",
        url: `${STORE}/products/vase`,
        imageUrl: `${STORE}/media/vase.webp`,
        price: "EUR 12.90",
      }),
    ]);
    expect(fetchWebsite).toHaveBeenCalledTimes(1);
    expect(fetchWebsite).toHaveBeenCalledWith(
      `${STORE}/products/vase`,
      expect.objectContaining({
        maxResponseBytes: 2 * 1024 * 1024,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("imports Shopify's public catalog with prices and product photos", async () => {
    fetchWebsite.mockResolvedValueOnce(
      new Response('<script src="/cdn/shop/theme.js"></script>', {
        headers: { "x-shopid": "shop" },
      }),
    );
    fetchWebsite.mockResolvedValueOnce(
      Response.json({
        products: [
          {
            title: "Clay mug",
            handle: "clay-mug",
            body_html: "<p>Glazed stoneware</p>",
            variants: [{ price: "19.00" }],
            images: [{ src: "//cdn.shopify.com/clay-mug.png" }],
          },
          { title: "Invalid handle", handle: "../admin" },
        ],
      }),
    );

    await expect(importStudioProducts(STORE, "workspace-a")).resolves.toEqual([
      expect.objectContaining({
        name: "Clay mug",
        description: "Glazed stoneware",
        url: `${STORE}/products/clay-mug`,
        imageUrl: "https://cdn.shopify.com/clay-mug.png",
        price: "19.00",
      }),
    ]);
    expect(fetchWebsite.mock.calls.map(([url]) => url)).toEqual([
      `${STORE}/`,
      `${STORE}/products.json?limit=20`,
    ]);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("suggests grounded products from visible marketing-page offers when no catalog is available", async () => {
    fetchWebsite.mockResolvedValueOnce(
      new Response(`
      <main>
        <h1>Marketing on autopilot</h1>
        <section id="pricing">
          <h2>Hire your CMO</h2>
          <div><h3>Intern</h3><p><span>$300</span><span>/mo</span></p><p hidden>$210 per month</p><p>For founders.</p></div>
          <div><h3>Manager</h3><p>$800/mo</p><p>For small teams.</p></div>
          <div><h3>Chief</h3><p>Custom</p><p>We build a plan just for you.</p></div>
        </section>
        <script>window.example = "Invisible instruction";</script>
      </main>
    `),
    );
    reserveResearch.mockResolvedValueOnce("OK");
    generateText.mockResolvedValueOnce({
      output: {
        offers: [
          {
            name: "Intern",
            description: "For founders.",
            price: "$300 /mo",
            evidence: "Intern $300 /mo For founders.",
          },
          {
            name: "Manager",
            description: "For small teams.",
            price: "$800/mo",
            evidence: "Manager $800/mo For small teams.",
          },
          {
            name: "Chief",
            description: "We build a plan just for you.",
            price: "Custom",
            evidence: "Chief Custom We build a plan just for you.",
          },
          {
            name: "Fabricated offer",
            description: "",
            price: "$50",
            evidence: "Fabricated offer costs $50.",
          },
        ],
      },
    });

    await expect(importStudioProducts(STORE, "workspace-a")).resolves.toEqual([
      expect.objectContaining({
        name: "Intern",
        description: "For founders.",
        price: "$300/mo",
        url: `${STORE}/`,
        imageUrl: null,
      }),
      expect.objectContaining({
        name: "Manager",
        description: "For small teams.",
        price: "$800/mo",
      }),
      expect.objectContaining({ name: "Chief", price: "Custom" }),
    ]);
    expect(reserveResearch).toHaveBeenCalledExactlyOnceWith(
      "studio:website-offers:workspace-a",
      "1",
      "EX",
      30,
      "NX",
    );
    expect(generateText).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        prompt: JSON.stringify({
          websiteText:
            "Marketing on autopilot Hire your CMO Intern $300 /mo For founders. Manager $800/mo For small teams. Chief Custom We build a plan just for you.",
        }),
        maxRetries: 0,
      }),
    );
  });

  it("drops a guessed description and a partial price even when the offer name is quoted", async () => {
    fetchWebsite.mockResolvedValueOnce(
      new Response(
        "<main><h2>Starter</h2><p>$19.99 per month for teams.</p></main>",
      ),
    );
    reserveResearch.mockResolvedValueOnce("OK");
    generateText.mockResolvedValueOnce({
      output: {
        offers: [
          {
            name: "Starter",
            price: "$19",
            description: "Unlimited usage",
            evidence: "Starter $19.99 per month for teams.",
          },
        ],
      },
    });
    await expect(importStudioProducts(STORE, "workspace-a")).resolves.toEqual([
      expect.objectContaining({ name: "Starter", description: "", price: "" }),
    ]);
  });

  it("leaves the catalog empty when AI research is unavailable", async () => {
    fetchWebsite.mockResolvedValueOnce(
      new Response("<main>Pricing information can be requested.</main>"),
    );
    reserveResearch.mockResolvedValueOnce(null);
    await expect(importStudioProducts(STORE, "workspace-a")).resolves.toEqual(
      [],
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("follows only same-site product links when the storefront has no product data", async () => {
    fetchWebsite.mockResolvedValueOnce(
      new Response(`
      <script type="application/ld+json">{invalid</script>
      <a href="/products/vase?source=home">Vase</a>
      <a href="/products/vase?source=sale">Vase</a>
      <a href="https://elsewhere.example.com/products/mug">External</a>
      <a href="/account">Account</a>
    `),
    );
    fetchWebsite.mockResolvedValueOnce(new Response(productPage("Vase")));

    const products = await importStudioProducts(STORE);
    expect(products.map(({ name }) => name)).toEqual(["Vase"]);
    expect(fetchWebsite.mock.calls.map(([url]) => url)).toEqual([
      `${STORE}/`,
      `${STORE}/products/vase`,
    ]);
  });

  it("follows product links relative to the final storefront URL after a redirect", async () => {
    fetchWebsite.mockImplementationOnce((_url, { onFinalUrl }) => {
      onFinalUrl("https://www.store.example.com/collection/");
      return Promise.resolve(
        new Response(
          '<a href="https://www.store.example.com/products/vase">Vase</a>',
        ),
      );
    });
    fetchWebsite.mockResolvedValueOnce(new Response(productPage("Vase")));

    const products = await importStudioProducts(STORE);
    expect(products[0]).toMatchObject({
      url: "https://www.store.example.com/products/vase",
      imageUrl: "https://www.store.example.com/media/vase.webp",
    });
  });

  it("continues finding products when the public Shopify feed is throttled", async () => {
    fetchWebsite.mockResolvedValueOnce(
      new Response(productPage("Vase") + '<a href="/products/mug">Mug</a>', {
        headers: { "x-shopid": "shop" },
      }),
    );
    fetchWebsite.mockResolvedValueOnce(new Response(null, { status: 429 }));
    fetchWebsite.mockResolvedValueOnce(new Response(productPage("Mug")));

    const products = await importStudioProducts(STORE);
    expect(products.map(({ name }) => name)).toEqual(["Vase", "Mug"]);
  });
});
