import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /.well-known/apple-app-site-association", () => {
  it("answers with JSON and no redirect", () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("associates the Sokosumi Apple app for web credentials only", async () => {
    // `webcredentials` is the service type the system asks for when an
    // `ASWebAuthenticationSession` uses an HTTPS callback. No `applinks`: the
    // app handles no universal links.
    expect(await GET().json()).toEqual({
      webcredentials: { apps: ["GVWN7HXYJB.com.sokosumi.app"] },
    });
  });
});
