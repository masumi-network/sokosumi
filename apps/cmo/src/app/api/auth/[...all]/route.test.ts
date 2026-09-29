import { expect, it } from "vitest";

import { GET, POST } from "./route";

const TOKEN_PATHS = [
  "/api/auth/get-access-token",
  "/api/auth/refresh-token",
  "/api/auth/account-info",
];

it.each(TOKEN_PATHS)("does not serve %s to the browser", async (path) => {
  const url = `https://cmo.xyz${path}`;
  for (const send of [GET, POST]) {
    const response = await send(new Request(url));
    const body = await response.text();
    expect(response.status).toBe(404);
    expect(body).not.toContain("accessToken");
    expect(body).not.toContain("refreshToken");
  }
});
