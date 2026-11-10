import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWebsite } = vi.hoisted(() => ({ fetchWebsite: vi.fn() }));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: fetchWebsite }));

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

    await expect(importStudioProducts(STORE)).resolves.toEqual([
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
