import { describe, expect, it } from "vitest";

import { posesAsCustomerTestimonial } from "./talking-video";

describe("posesAsCustomerTestimonial", () => {
  it.each([
    "I've been using this cream for three weeks and my skin is clear.",
    "As a customer, I can tell you it works.",
    "I bought it last month. Best decision ever.",
    "Since I started using it, I sleep better.",
    "It changed my life.",
    "Als Kundin kann ich es nur empfehlen.",
    "Seit ich die App nutze, spare ich Zeit.",
    "Como cliente, lo recomiendo.",
  ])("refuses a customer's account: %s", (script) => {
    expect(posesAsCustomerTestimonial(script)).toBe(true);
  });

  it.each([
    "Stop scrolling. We built a planner that does your Monday for you.",
    "Three things nobody tells you about cold brew. Number one: grind size.",
    "Our customers save four hours a week. Here is how it works.",
    "Wir haben eine App gebaut, die deine Woche plant.",
  ])("lets the brand speak for itself: %s", (script) => {
    expect(posesAsCustomerTestimonial(script)).toBe(false);
  });
});
