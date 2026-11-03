import type { NextConfig } from "next";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  applyDocumentSecurityHeaders,
  documentSecurityHeaders,
} from "./document-security-headers";

vi.mock("@sentry/nextjs/config", () => ({
  withSentryConfig: (config: NextConfig) => config,
}));
vi.mock("@vercel/related-projects", () => ({
  withRelatedProject: () => "https://core.example.com",
}));
vi.mock("eve/next", () => ({ withEve: (config: NextConfig) => config }));
vi.mock("next-intl/plugin", () => ({
  default: () => (config: NextConfig) => config,
}));

import nextConfig from "@/../next.config";

describe("document framing headers", () => {
  it.each(["/n/weekly/embed", "/n/weekly/embed/"])(
    "permits cross-origin iframe framing only on signup embeds: %s",
    async (path) => {
      const response = await unstable_getResponseFromNextConfig({
        url: `https://app.example.com${path}`,
        nextConfig,
      });
      expect(response.headers.get("X-Frame-Options")).toBeNull();
      expect(response.headers.get("Content-Security-Policy")).toBeNull();
      for (const { key, value } of documentSecurityHeaders({
        includeHsts: false,
        pathname: path,
      })) {
        expect(response.headers.get(key)).toBe(value);
      }
    },
  );

  it.each([
    "/",
    "/signin",
    "/projects/p1/newsletter",
    "/n/weekly",
    "/n/weekly/archive",
    "/n/weekly/p/hello",
    "/n/weekly/embed/child",
    "/n/weekly/embedded",
    "/n/embed",
    "/n/weekly/other/embed",
    "/other/n/weekly/embed",
    "/api/example",
    "/n/weekly/embed.html",
  ])("keeps all other document routes protected: %s", async (path) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://app.example.com${path}`,
      nextConfig,
    });
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    const proxyResponse = NextResponse.next();
    applyDocumentSecurityHeaders(proxyResponse, {
      includeHsts: false,
      pathname: path,
    });
    expect(proxyResponse.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("retains the other security headers and HSTS on embeds", () => {
    const response = NextResponse.next();
    applyDocumentSecurityHeaders(response, {
      includeHsts: true,
      pathname: "/n/weekly/embed",
    });
    expect(response.headers.get("X-Frame-Options")).toBeNull();
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });
});
