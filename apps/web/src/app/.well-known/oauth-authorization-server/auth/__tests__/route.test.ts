import { GET } from "../route";

describe("legacy oauth authorization server metadata route", () => {
  it("redirects the legacy auth path to the canonical api/auth path", async () => {
    const response = await GET(
      new Request(
        "https://app.sokosumi.com/.well-known/oauth-authorization-server/auth",
      ),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.com/.well-known/oauth-authorization-server/api/auth",
    );
  });
});
