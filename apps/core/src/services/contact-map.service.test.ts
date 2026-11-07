import { describe, expect, it } from "vitest";
import { parseGeocodeAnswer, placeQuery } from "./contact-map.service";

describe("placeQuery", () => {
  it("treats case and spacing as one place", () => {
    expect(placeQuery("  Zurich,   Switzerland ")).toBe("zurich, switzerland");
    expect(placeQuery("   ")).toBe("");
  });
});

describe("parseGeocodeAnswer", () => {
  it("puts each answer at its line and leaves the rest null", () => {
    const text =
      'Sure: {"places": [{"i": 2, "label": "Berlin, Germany", "lat": 52.52, "lng": 13.4}, {"i": 9, "label": "Nowhere", "lat": 0, "lng": 0}, {"i": 1, "label": "Bad", "lat": 120, "lng": 0}]}';
    expect(parseGeocodeAnswer(text, 3)).toEqual([
      null,
      { label: "Berlin, Germany", latitude: 52.52, longitude: 13.4 },
      null,
    ]);
  });

  it("gives nulls for an answer that is not JSON", () => {
    expect(parseGeocodeAnswer("I cannot help", 2)).toEqual([null, null]);
  });
});
