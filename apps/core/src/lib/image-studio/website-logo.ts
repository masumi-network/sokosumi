import { isStudioLogoMime, sniffImageMimeFromBytes } from "@sokosumi/utils";
import { DomUtils, parseDocument } from "htmlparser2";
import sharp from "sharp";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function declaredWebsiteLogoUrls(
  html: string,
  baseUrl: string,
): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 5 || urls.size >= 5)
      return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    const node = asObject(value);
    const types = Array.isArray(node["@type"])
      ? node["@type"]
      : [node["@type"]];
    if (
      types.some(
        (type) =>
          typeof type === "string" &&
          /(?:Organization|Corporation|Business|Store|Restaurant|Brand)$/.test(
            type,
          ),
      )
    ) {
      const logos = Array.isArray(node.logo) ? node.logo : [node.logo];
      for (const logo of logos) {
        const image = asObject(logo);
        const source =
          typeof logo === "string"
            ? logo
            : (image.contentUrl ?? image.url ?? image["@id"]);
        const url =
          typeof source === "string" && source.trim()
            ? URL.parse(source, baseUrl)
            : null;
        if (
          url &&
          (url.protocol === "https:" || url.protocol === "http:") &&
          !url.username &&
          !url.password
        ) {
          url.hash = "";
          if (url.href !== baseUrl) urls.add(url.href);
        }
        if (urls.size >= 5) return;
      }
    }
    visit(node["@graph"], depth + 1);
    visit(node.publisher, depth + 1);
  };

  const document = parseDocument(html);
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
      visit(JSON.parse(DomUtils.textContent(script)));
    } catch {
      // One malformed declaration should not hide the rest of the site's logos.
    }
    if (urls.size >= 5) break;
  }
  return [...urls];
}

export async function prepareWebsiteLogo(icon: {
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<{ bytes: Buffer; contentType: string } | null> {
  const bytes = Buffer.from(icon.bytes);
  const mime = sniffImageMimeFromBytes(bytes);
  const svg = icon.contentType === "image/svg+xml";
  if (!svg && (!mime || !isStudioLogoMime(mime))) return null;
  try {
    // Decode from memory with no base URL, and publish only the rendered pixels.
    const image = sharp(bytes, { limitInputPixels: 4_000_000 });
    const { format, pages = 1 } = await image.metadata();
    if (pages !== 1 || (svg && format !== "svg")) return null;
    return {
      bytes: await image
        .timeout({ seconds: 2 })
        .autoOrient()
        .resize({
          width: 512,
          height: 512,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer(),
      contentType: "image/png",
    };
  } catch {
    return null;
  }
}
