import { describe, expect, it } from "vitest";

import { anchorVerificationCallbackToWebApp } from "./verification-email-callback";

const CORE = "https://api.sokosumi.test/auth/verify-email?token=abc";
const WEB = "https://app.sokosumi.test";

describe("anchorVerificationCallbackToWebApp", () => {
  it("sends the relative default to the web app, not the API host", () => {
    const result = new URL(
      anchorVerificationCallbackToWebApp(`${CORE}&callbackURL=%2F`, WEB),
    );

    expect(result.searchParams.get("callbackURL")).toBe(`${WEB}/`);
  });

  it("anchors a relative deep link to the web app", () => {
    const result = new URL(
      anchorVerificationCallbackToWebApp(`${CORE}&callbackURL=%2Fchat`, WEB),
    );

    expect(result.searchParams.get("callbackURL")).toBe(`${WEB}/chat`);
  });

  it("adds the web app callback when the link carries none", () => {
    const result = new URL(anchorVerificationCallbackToWebApp(CORE, WEB));

    expect(result.searchParams.get("callbackURL")).toBe(`${WEB}/`);
    expect(result.searchParams.get("token")).toBe("abc");
  });

  it("leaves an absolute callback alone for originCheck to validate", () => {
    const absolute = `${CORE}&callbackURL=${encodeURIComponent(`${WEB}/agents`)}`;

    expect(anchorVerificationCallbackToWebApp(absolute, WEB)).toBe(absolute);
  });

  it("does not promote a protocol-relative callback to an off-origin URL", () => {
    const result = new URL(
      anchorVerificationCallbackToWebApp(
        `${CORE}&callbackURL=${encodeURIComponent("//evil.example/phish")}`,
        WEB,
      ),
    );

    expect(result.searchParams.get("callbackURL")).toBe(`${WEB}/`);
  });

  it("does not follow a backslash path off the web origin", () => {
    const result = new URL(
      anchorVerificationCallbackToWebApp(
        `${CORE}&callbackURL=${encodeURIComponent("/\\evil.example")}`,
        WEB,
      ),
    );

    expect(result.searchParams.get("callbackURL")).toBe(`${WEB}/`);
  });

  it("returns a malformed link unchanged", () => {
    expect(anchorVerificationCallbackToWebApp("not a url", WEB)).toBe(
      "not a url",
    );
  });
});
