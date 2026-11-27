import { describe, expect, it } from "vitest";
import {
  publicSpeedInsight,
  publicSpeedText,
  publicSpeedUrl,
  speedLighthouseVersion,
} from "./seo-speed-guards";

const insight = {
  id: "unused-javascript",
  title: "Reduce unused JavaScript",
  detail: "Potential savings of 50% or 108 KiB.",
  action: "Defer scripts until they are needed.",
};
const ENCODED_KEY = "sk%5Flive%5F51QX9J5eXampleSecretValue123456";

describe("speed guards", () => {
  it("refuses an insight with a percent run that is no UTF-8 text", () => {
    expect(publicSpeedInsight(insight)).toBe(true);
    for (const detail of ["%FF", `See %FF${ENCODED_KEY}`, `See ${ENCODED_KEY}`])
      expect(publicSpeedInsight({ ...insight, detail }), detail).toBe(false);
  });

  it("reads free text percent-decoded too", () => {
    expect(publicSpeedText(" Sells 50% of the plans. ", 200)).toBe(
      "Sells 50% of the plans.",
    );
    for (const text of [
      `Use ${ENCODED_KEY}`,
      "Ask private%40example.com",
      "%FF",
    ])
      expect(publicSpeedText(text, 200), text).toBeUndefined();
  });

  it("refuses a card number as a Lighthouse version", () => {
    expect(speedLighthouseVersion("13.0.0-dev.20261101")).toBe(
      "13.0.0-dev.20261101",
    );
    expect(speedLighthouseVersion("4111111111111111")).toBeNull();
  });

  it("refuses a URL with an empty query delimiter", () => {
    expect(publicSpeedUrl("https://example.test/p")).toBe(true);
    expect(publicSpeedUrl("https://example.test/p?")).toBe(false);
  });
});
