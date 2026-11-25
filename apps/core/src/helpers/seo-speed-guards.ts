import {
  containsSokoBotCredentialMaterial,
  containsSokoBotSensitiveMaterial,
} from "@sokosumi/soko-bot";
import { publicExplorationText, publicExplorationUrl } from "@sokosumi/utils";
import { reportObject } from "./project-seo-public-report";

/**
 * The guards of speed data. Each one holds on four paths: a fresh import and a stored read, of an audit's
 * page speed and of the site speed table. A path calls the function here and keeps no copy of the rule.
 */
export const SPEED_DEVICES = ["mobile", "desktop"] as const;
export type SpeedDevice = (typeof SPEED_DEVICES)[number];

/** The worker can name the home page without its root slash. A public URL has one. */
export function speedPageUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const href = URL.parse(value)?.href;
  return href === value + "/" ? href : value;
}

/**
 * A URL that speed data can hold. A digit run in a path is no card number (an ISBN-13 can pass that
 * checksum), so the URL gets the credential checks only.
 */
export function publicSpeedUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    publicExplorationUrl(value) &&
    !containsSokoBotCredentialMaterial(value)
  );
}

/** The worker's free text, trimmed. Undefined: the text is too long or holds private or credential material. */
export function publicSpeedText(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text &&
    text.length <= max &&
    publicExplorationText(text) &&
    !containsSokoBotSensitiveMaterial(text)
    ? text
    : undefined;
}

/** A measurement whose page URL, tested URL and field URL are all public. */
export function publicSpeedMeasurement(value: unknown) {
  const row = reportObject(value);
  const field = reportObject(row?.field);
  return (
    !!row &&
    [row.pageUrl, row.testedUrl, ...(field?.url == null ? [] : [field.url])]
      .map(speedPageUrl)
      .every(publicSpeedUrl)
  );
}

/**
 * The devices a table row can show. `full`, or a Report from before the tiers: both. `reduced`: the device
 * of its check, none when Core cannot read the check. `none`: no device.
 */
export function speedRowDevices(
  tier: unknown,
  check: { device: SpeedDevice } | undefined,
): readonly SpeedDevice[] {
  if (tier === "none") return [];
  if (tier === "reduced") return check ? [check.device] : [];
  return SPEED_DEVICES;
}
