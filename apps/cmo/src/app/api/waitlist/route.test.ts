import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { normalizeWebsite, POST } from "./route";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SOKOSUMI_API_KEY", "test-key");
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function signup(body: object): Request {
  return new Request("https://app.cmo.xyz/api/waitlist", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

it("adds the email and website as a row in the waitlist table", async () => {
  fetchMock
    .mockResolvedValueOnce(
      Response.json({
        data: {
          columns: [
            { id: "col-email", name: "Email" },
            { id: "col-url", name: "URL" },
          ],
        },
      }),
    )
    .mockResolvedValueOnce(Response.json({ data: {} }));

  const response = await POST(
    signup({ email: "ana@acme.io", website: "acme.io" }),
  );

  expect(response.status).toBe(200);
  const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(url).toMatch(/\/drive\/tables\/[\w-]+\/rows$/);
  expect(JSON.parse(String(init.body)).insert).toEqual([
    { values: { "col-email": "ana@acme.io", "col-url": "https://acme.io" } },
  ]);
});

it("refuses a bad email or website without calling Sokosumi", async () => {
  expect((await POST(signup({ email: "nope" }))).status).toBe(400);
  expect(
    (await POST(signup({ email: "ana@acme.io", website: "not a site" })))
      .status,
  ).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("pauses signups when no key is set", async () => {
  vi.stubEnv("SOKOSUMI_API_KEY", "");
  const response = await POST(signup({ email: "ana@acme.io" }));
  expect(response.status).toBe(503);
});

it("normalizes the optional website", () => {
  expect(normalizeWebsite("")).toBe("");
  expect(normalizeWebsite("acme.io")).toBe("https://acme.io");
  expect(normalizeWebsite("http://acme.io/x")).toBe("http://acme.io/x");
  expect(normalizeWebsite("localhost")).toBeNull();
});
