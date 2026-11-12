import { randomUUID } from "node:crypto";

import { ssrfSafeFetch } from "@sokosumi/net";
import { isValidHttpUrl } from "@sokosumi/utils";
import { DomUtils, parseDocument } from "htmlparser2";
import { z } from "zod";

import { suggestWebsiteOffers } from "@/lib/image-studio/website-brand-profile";
import { sitePlatformOf } from "@/lib/site-platform";
import {
  MAX_STUDIO_PRODUCTS,
  STUDIO_PRODUCT_DESCRIPTION_LIMIT,
  STUDIO_PRODUCT_NAME_LIMIT,
  STUDIO_PRODUCT_PRICE_LIMIT,
  type StudioProduct,
} from "@/schemas/studio-product.schema";

const PAGE_BYTE_LIMIT = 2 * 1024 * 1024;
const IMPORT_BYTE_LIMIT = 8 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 12_000;
const MAX_LINKED_PAGES = 8;
const LINK_CONCURRENCY = 3;
const PRODUCT_PATH = /\/(?:products?|p)\/[^/]+\/?$/i;

const shopifyResponse = z.object({
  products: z.array(z.unknown()),
});
const shopifyProduct = z.object({
  title: z.string(),
  handle: z.string().regex(/^[\p{L}\p{N}_-]+$/u),
  body_html: z.string().nullish(),
  images: z.array(z.object({ src: z.string() })).optional(),
  variants: z
    .array(z.object({ price: z.union([z.string(), z.number()]) }))
    .optional(),
});
const objectSchema = z.record(z.string(), z.unknown());

function asObject(value: unknown): Record<string, unknown> {
  const parsed = objectSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function plainText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const document = parseDocument(value);
  DomUtils.removeSubsets(
    DomUtils.getElementsByTagName(
      (name) => name === "script" || name === "style",
      document.children,
    ),
  ).forEach(DomUtils.removeElement);
  return DomUtils.textContent(document)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function publicLink(value: unknown, base: URL): URL | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = URL.parse(value, base);
  if (!url || url.username || url.password || !isValidHttpUrl(url.href))
    return null;
  url.hash = "";
  return url.href.length <= 2_048 ? url : null;
}

function priceOf(value: unknown, currency?: unknown): string {
  const amount = typeof value === "number" ? String(value) : value;
  if (typeof amount !== "string" || !/^\d+(?:\.\d+)?$/.test(amount)) return "";
  const code =
    typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
      ? `${currency} `
      : "";
  return `${code}${amount}`.slice(0, STUDIO_PRODUCT_PRICE_LIMIT);
}

function structuredProducts(
  document: ReturnType<typeof parseDocument>,
  pageUrl: URL,
) {
  const found: StudioProduct[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || found.length >= MAX_STUDIO_PRODUCTS) return;
    for (const candidate of asList(value)) {
      if (found.length >= MAX_STUDIO_PRODUCTS) return;
      const node = asObject(candidate);
      if (
        asList(node["@type"]).some(
          (type) =>
            type === "Product" ||
            type === "https://schema.org/Product" ||
            type === "http://schema.org/Product",
        )
      ) {
        const name = plainText(node.name, STUDIO_PRODUCT_NAME_LIMIT);
        if (!name) continue;
        const offers = asList(node.offers).map(asObject);
        const offer =
          offers.find(
            ({ price, lowPrice }) => price != null || lowPrice != null,
          ) ?? {};
        const imageUrl = asList(node.image)
          .map((image) =>
            publicLink(
              typeof image === "string"
                ? image
                : (asObject(image).url ?? asObject(image).contentUrl),
              pageUrl,
            ),
          )
          .find((image) => image !== null);
        found.push({
          id: randomUUID(),
          name,
          description: plainText(
            node.description,
            STUDIO_PRODUCT_DESCRIPTION_LIMIT,
          ),
          price: priceOf(offer.price ?? offer.lowPrice, offer.priceCurrency),
          url: publicLink(node.url ?? offer.url, pageUrl)?.href ?? pageUrl.href,
          imageUrl: imageUrl?.href ?? null,
        });
      }
      for (const key of [
        "@graph",
        "itemListElement",
        "item",
        "mainEntity",
        "hasVariant",
      ]) {
        if (node[key]) visit(node[key], depth + 1);
      }
    }
  };

  for (const script of DomUtils.getElementsByTagName(
    "script",
    document.children,
  )) {
    if (
      script.attribs.type?.toLowerCase().split(";")[0]?.trim() !==
      "application/ld+json"
    )
      continue;
    try {
      const data: unknown = JSON.parse(DomUtils.textContent(script));
      visit(data, 0);
    } catch {
      // A broken script does not hide valid products elsewhere on the page.
    }
  }
  return found;
}

function linkedProductPages(
  document: ReturnType<typeof parseDocument>,
  pageUrl: URL,
) {
  const links = new Set<string>();
  for (const anchor of DomUtils.getElementsByTagName("a", document.children)) {
    const link = publicLink(anchor.attribs.href, pageUrl);
    if (
      !link ||
      link.origin !== pageUrl.origin ||
      !PRODUCT_PATH.test(link.pathname)
    )
      continue;
    link.search = "";
    if (link.pathname === pageUrl.pathname) continue;
    links.add(link.href);
    if (links.size >= MAX_LINKED_PAGES) break;
  }
  return [...links].map((url) => new URL(url));
}

export async function importStudioProducts(
  website: string,
  workspaceId?: string,
): Promise<StudioProduct[]> {
  const signal = AbortSignal.timeout(IMPORT_TIMEOUT_MS);
  let remainingBytes = IMPORT_BYTE_LIMIT;
  async function read(url: URL, accept: string) {
    if (remainingBytes <= 0 || signal.aborted) return null;
    try {
      let finalUrl = url.href;
      const response = await ssrfSafeFetch(url.href, {
        headers: { Accept: accept },
        onFinalUrl: (href) => {
          finalUrl = href;
        },
        signal,
        maxResponseBytes: Math.min(PAGE_BYTE_LIMIT, remainingBytes),
        onResponseBytes: (bytes) => {
          remainingBytes -= bytes;
          if (remainingBytes < 0)
            throw new Error("Product import exceeded its byte budget");
        },
      });
      const base = publicLink(finalUrl, url);
      return response.ok && base ? { response, url: base } : null;
    } catch {
      return null;
    }
  }

  const page = await read(new URL(website), "text/html");
  if (!page) return [];
  const websiteUrl = page.url;
  const html = await page.response.text();
  const document = parseDocument(html);
  const products = structuredProducts(document, websiteUrl);
  if (PRODUCT_PATH.test(websiteUrl.pathname) && products.length > 0)
    return products;

  const structuredCount = products.length;
  if (sitePlatformOf(page.response.headers, html) === "shopify") {
    const feed = new URL(
      `/products.json?limit=${MAX_STUDIO_PRODUCTS}`,
      websiteUrl,
    );
    const catalog = await read(feed, "application/json");
    const parsed = shopifyResponse.safeParse(
      await catalog?.response.json().catch(() => null),
    );
    if (parsed.success) {
      for (const row of parsed.data.products.slice(0, MAX_STUDIO_PRODUCTS)) {
        const product = shopifyProduct.safeParse(row);
        if (!product.success) continue;
        const { title, handle, body_html, images, variants } = product.data;
        const name = plainText(title, STUDIO_PRODUCT_NAME_LIMIT);
        const url = publicLink(
          `/products/${encodeURIComponent(handle)}`,
          websiteUrl,
        );
        if (!name || !url) continue;
        products.push({
          id: randomUUID(),
          name,
          description: plainText(body_html, STUDIO_PRODUCT_DESCRIPTION_LIMIT),
          price: priceOf(variants?.[0]?.price),
          url: url.href,
          imageUrl: publicLink(images?.[0]?.src, websiteUrl)?.href ?? null,
        });
      }
    }
  }

  if (
    products.length === structuredCount &&
    products.length < MAX_STUDIO_PRODUCTS
  ) {
    const knownUrls = new Set(products.map((product) => product.url));
    const links = linkedProductPages(document, websiteUrl).filter(
      (url) => !knownUrls.has(url.href),
    );
    for (
      let offset = 0;
      offset < links.length && products.length < MAX_STUDIO_PRODUCTS;
      offset += LINK_CONCURRENCY
    ) {
      const batch = links.slice(offset, offset + LINK_CONCURRENCY);
      const pages = await Promise.all(
        batch.map(async (url) => {
          const linked = await read(url, "text/html");
          return linked
            ? structuredProducts(
                parseDocument(await linked.response.text()),
                linked.url,
              )
            : [];
        }),
      );
      products.push(...pages.flat());
    }
  }

  if (products.length === 0 && workspaceId) {
    const main = DomUtils.getElementsByTagName(
      "main",
      document.children,
      true,
      1,
    )[0];
    const nodes = main?.children ?? document.children;
    DomUtils.removeSubsets(
      DomUtils.filter(
        (node) =>
          "attribs" in node &&
          (/^(?:head|script|style|noscript|template|nav|footer)$/.test(
            node.name,
          ) ||
            node.attribs.hidden !== undefined ||
            node.attribs["aria-hidden"] === "true"),
        nodes,
      ),
    ).forEach(DomUtils.removeElement);
    const text = DomUtils.filter((node) => node.type === "text", nodes)
      .map(DomUtils.textContent)
      .join(" ");
    const offers = await suggestWebsiteOffers(workspaceId, text);
    return offers.map((offer) => ({
      ...offer,
      id: randomUUID(),
      url: websiteUrl.href,
      imageUrl: null,
    }));
  }

  return [
    ...new Map(
      products.map((product) => [
        product.url === websiteUrl.href
          ? JSON.stringify([product.url, product.name])
          : product.url,
        product,
      ]),
    ).values(),
  ].slice(0, MAX_STUDIO_PRODUCTS);
}
