import type { DisplayImageRole } from "./google-display-images";
import {
  adDisplayUrl,
  filledCallouts,
  filledSitelinks,
  type SitelinkFormValues,
} from "./google-search";

export function rotateTexts(
  texts: readonly string[],
  variant: number,
  count: number,
): string[] {
  const filled = texts.map((text) => text.trim()).filter(Boolean);
  return Array.from(
    { length: Math.min(count, filled.length) },
    (_, index) => filled[(variant + index) % filled.length],
  );
}

export function previewVariants(...lists: readonly (readonly string[])[]) {
  return Math.max(
    1,
    ...lists.map((texts) => texts.filter((text) => text.trim()).length),
  );
}

function domainOf(finalUrl: string): string {
  return adDisplayUrl(finalUrl, "", "");
}

interface SearchAdValues {
  finalUrl: string;
  path1: string;
  path2: string;
  headlines: readonly string[];
  descriptions: readonly string[];
  sitelinks: readonly SitelinkFormValues[];
  callouts: readonly string[];
}

export function searchAdPreview(values: SearchAdValues, variant: number) {
  return {
    displayUrl: adDisplayUrl(values.finalUrl, values.path1, values.path2),
    domain: domainOf(values.finalUrl),
    headline: rotateTexts(values.headlines, variant, 3).join(" | "),
    description: rotateTexts(values.descriptions, variant, 2).join(" "),
    sitelinks: filledSitelinks(values.sitelinks).map(({ text }) => text),
    callouts: filledCallouts(values.callouts),
    variants: previewVariants(values.headlines, values.descriptions),
  };
}

interface DisplayAdValues {
  finalUrl: string;
  businessName: string;
  displayHeadlines: readonly string[];
  longHeadline: string;
  displayDescriptions: readonly string[];
  images: readonly { role: DisplayImageRole; url: string }[];
}

function imageOf(
  images: DisplayAdValues["images"],
  role: DisplayImageRole,
  variant: number,
): string | null {
  const urls = images.filter((image) => image.role === role);
  return urls.length > 0 ? urls[variant % urls.length].url : null;
}

export function displayAdPreview(values: DisplayAdValues, variant: number) {
  const countOf = (role: DisplayImageRole) =>
    values.images.filter((image) => image.role === role).length;
  return {
    businessName: values.businessName.trim(),
    domain: domainOf(values.finalUrl),
    headline: rotateTexts(values.displayHeadlines, variant, 1)[0] ?? "",
    longHeadline: values.longHeadline.trim(),
    description: rotateTexts(values.displayDescriptions, variant, 1)[0] ?? "",
    landscape: imageOf(values.images, "LANDSCAPE", variant),
    square: imageOf(values.images, "SQUARE", variant),
    logo: imageOf(values.images, "LOGO", variant),
    variants: Math.max(
      previewVariants(values.displayHeadlines, values.displayDescriptions),
      countOf("LANDSCAPE"),
      countOf("SQUARE"),
      countOf("LOGO"),
    ),
  };
}
