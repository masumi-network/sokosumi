import type { DisplayImageRole } from "./google-display-images";
import {
  adDisplayUrl,
  filledCallouts,
  filledSitelinks,
  type SitelinkFormValues,
} from "./google-search";

/**
 * How the create wizard pictures an ad before it exists. Google mixes a
 * responsive ad's texts (and a Display ad's images) itself, so the preview
 * shows one combination at a time; `variant` steps through them.
 */

/**
 * Up to `count` of the filled texts, trimmed, starting at the `variant`th and
 * wrapping. A text is never shown twice in one combination.
 */
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

/** How many combinations are worth stepping through: one per text of the longest list. */
export function previewVariants(...lists: readonly (readonly string[])[]) {
  return Math.max(
    1,
    ...lists.map((texts) => texts.filter((text) => text.trim()).length),
  );
}

/** The domain an ad shows, `example.com` until the final URL is valid. */
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

/** A Search result as Google lays it out: three headlines, two descriptions. */
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
  /** Each image's role and where to show it from. */
  images: readonly { role: DisplayImageRole; url: string }[];
}

/** One picture of `role`, stepping with the variant; null without one. */
function imageOf(
  images: DisplayAdValues["images"],
  role: DisplayImageRole,
  variant: number,
): string | null {
  const urls = images.filter((image) => image.role === role);
  return urls.length > 0 ? urls[variant % urls.length].url : null;
}

/** A Display ad's parts for one combination, each image shape on its own. */
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
    ),
  };
}
