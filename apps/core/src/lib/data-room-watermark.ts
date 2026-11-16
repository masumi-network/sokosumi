import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";

/**
 * Stamps who opened a file, and when, across every page or image, so a copy
 * that leaves the room still names where it came from. Faint and diagonal,
 * so the document stays readable.
 */

/** "anna@fund.com · 9 Nov 2026 14:05 UTC" */
export function watermarkText(email: string, at: Date): string {
  const date = at.toISOString().slice(0, 16).replace("T", " ");
  return `${email} · ${date} UTC`;
}

export type WatermarkKind = "pdf" | "image";

/** Which stamp a file takes, or null when its type cannot carry one. */
export function watermarkKindFor(
  mimeType: string | null,
): WatermarkKind | null {
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp"
  )
    return "image";
  return null;
}

export async function watermarkPdf(
  bytes: Uint8Array,
  text: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(10, Math.min(width, height) / 32);
    const textWidth = font.widthOfTextAtSize(text, size);
    // Three lines up the diagonal, so cropping one away leaves the others.
    for (const fraction of [0.25, 0.5, 0.75]) {
      page.drawText(text, {
        x: width * fraction - textWidth / 2,
        y: height * fraction - size,
        size,
        font,
        color: rgb(0.45, 0.45, 0.45),
        opacity: 0.22,
        rotate: degrees(35),
      });
    }
  }
  return pdf.save();
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function watermarkImage(
  bytes: Uint8Array,
  text: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const image = sharp(bytes, { failOn: "none" }).rotate();
  const { width = 1024, height = 1024, format } = await image.metadata();
  const size = Math.max(12, Math.round(Math.min(width, height) / 28));
  const lines = [0.25, 0.5, 0.75]
    .map(
      (fraction) =>
        `<text x="${Math.round(width * fraction)}" y="${Math.round(height * fraction)}" font-size="${size}" text-anchor="middle" transform="rotate(-35 ${Math.round(width * fraction)} ${Math.round(height * fraction)})" fill="rgb(115,115,115)" fill-opacity="0.35" font-family="Helvetica, Arial, sans-serif">${escapeXml(text)}</text>`,
    )
    .join("");
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines}</svg>`,
  );
  const stamped = image.composite([{ input: overlay, top: 0, left: 0 }]);
  if (format === "png")
    return { bytes: await stamped.png().toBuffer(), contentType: "image/png" };
  if (format === "webp")
    return {
      bytes: await stamped.webp().toBuffer(),
      contentType: "image/webp",
    };
  return {
    bytes: await stamped.jpeg({ quality: 90 }).toBuffer(),
    contentType: "image/jpeg",
  };
}
