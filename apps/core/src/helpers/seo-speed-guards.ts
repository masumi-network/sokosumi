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
 * checksum), so the URL gets the credential checks only. The checks read the URL as written and its
 * decoded path: `sk%5Flive%5F...` is a key too. A public URL has no query and no fragment delimiter:
 * `/page#` and `/page?` are `/page` again.
 */
export function publicSpeedUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.includes("#") ||
    value.includes("?") ||
    !publicExplorationUrl(value)
  )
    return false;
  try {
    return ![value, decodeURIComponent(new URL(value).pathname)].some(
      containsSokoBotCredentialMaterial,
    );
  } catch {
    // A path that cannot be decoded is not public.
    return false;
  }
}

/**
 * Public text without private or credential material, as written and percent-decoded. Each run of %XX
 * groups is decoded on its own: a lone "%" elsewhere ("50% less") does not stop the decoding. A run that is
 * no UTF-8 text is not public: its other groups would be checked only as written.
 */
function publicText(text: string) {
  let decoded: string;
  try {
    decoded = text.replace(/(?:%[0-9a-fA-F]{2})+/g, decodeURIComponent);
  } catch {
    return false;
  }
  return [text, decoded].every(
    (form) =>
      publicExplorationText(form) && !containsSokoBotSensitiveMaterial(form),
  );
}

/** The worker's free text, trimmed. Undefined: the text is too long or holds private or credential material. */
export function publicSpeedText(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max && publicText(text) ? text : undefined;
}

/**
 * The URL of a measured field in the one form Core stores. Host case and a missing root slash spell the
 * same URL; another spelling is not read. The credential checks read the URL as written first: the
 * normal form is not the text the worker sent.
 */
export function speedFieldUrl(value: unknown) {
  if (typeof value !== "string" || containsSokoBotCredentialMaterial(value))
    return undefined;
  const href = URL.parse(value)?.href;
  return href &&
    publicSpeedUrl(href) &&
    [value, value + "/"].some(
      (written) => written.toLowerCase() === href.toLowerCase(),
    )
    ? href
    : undefined;
}

/**
 * The Lighthouse version of a lab measurement: digits and dots, with an optional short pre-release suffix,
 * and no credential or card material (a digit run passes the form). Null: any other value. The measurement stays.
 */
export function speedLighthouseVersion(value: unknown) {
  return typeof value === "string" &&
    value.length <= 32 &&
    /^\d[\d.]*(?:-[a-zA-Z0-9.-]+)?$/.test(value) &&
    !containsSokoBotSensitiveMaterial(value)
    ? value
    : null;
}

const publicInsightText = (text: unknown) =>
  typeof text === "string" && publicText(text);

/** A lab insight whose id, group (when given), title, detail and action are public text. */
export function publicSpeedInsight(value: unknown) {
  const insight = reportObject(value);
  return (
    !!insight &&
    [
      insight.id,
      ...(insight.group === undefined ? [] : [insight.group]),
      insight.title,
      insight.detail,
      insight.action,
    ].every(publicInsightText)
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
