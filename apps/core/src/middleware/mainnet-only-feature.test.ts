import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  MAINNET_ONLY_FEATURE_MESSAGE,
  requireMainnetOnlyFeatureForMethods,
  requireMainnetOnlyFeatureMiddleware,
} from "@/middleware/mainnet-only-feature";
import { NETWORK_HEADER } from "@/middleware/network-scope";

function buildApp(
  authContext?: AuthenticationContext,
  methods?: readonly string[],
) {
  const app = new Hono<{ Variables: Partial<AuthVariables> }>();
  app.onError(errorHandler);
  if (authContext) {
    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContext);
      await next();
    });
  }
  app.use(
    "*",
    methods
      ? requireMainnetOnlyFeatureForMethods(methods)
      : requireMainnetOnlyFeatureMiddleware,
  );
  app.get("/check", (c) => c.json({ ok: true }));
  app.post("/check", (c) => c.json({ ok: true }));
  return app;
}

describe("requireMainnetOnlyFeatureMiddleware", () => {
  it("allows Mainnet requests with no header or with mainnet header", async () => {
    const app = buildApp({
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });

    const withoutHeader = await app.request("/check");
    expect(withoutHeader.status).toBe(200);

    const withMainnet = await app.request("/check", {
      headers: { [NETWORK_HEADER]: "mainnet" },
    });
    expect(withMainnet.status).toBe(200);
  });

  it("answers 422 mainnet_only_feature for X-Sokosumi-Network: preprod", async () => {
    const app = buildApp({
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });

    const response = await app.request("/check", {
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "UnprocessableEntity",
      kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
      message: MAINNET_ONLY_FEATURE_MESSAGE,
    });
  });

  it("answers 422 mainnet_only_feature for a verified Preprod API key without a header", async () => {
    const app = buildApp({
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "api_key",
      apiKeyNetwork: "preprod",
    });

    const response = await app.request("/check");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
      message: MAINNET_ONLY_FEATURE_MESSAGE,
    });
  });

  it("allows a verified Mainnet API key without a header", async () => {
    const app = buildApp({
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "api_key",
      apiKeyNetwork: "mainnet",
    });

    const response = await app.request("/check");
    expect(response.status).toBe(200);
  });

  it("answers 403 api_key_network_mismatch when header contradicts API key network", async () => {
    const mainnetKeyApp = buildApp({
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "api_key",
      apiKeyNetwork: "mainnet",
    });
    const mainnetKeyPreprodHeader = await mainnetKeyApp.request("/check", {
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(mainnetKeyPreprodHeader.status).toBe(403);
    expect(await mainnetKeyPreprodHeader.json()).toMatchObject({
      kind: CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH,
    });

    const preprodKeyApp = buildApp({
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "api_key",
      apiKeyNetwork: "preprod",
    });
    const preprodKeyMainnetHeader = await preprodKeyApp.request("/check", {
      headers: { [NETWORK_HEADER]: "mainnet" },
    });
    expect(preprodKeyMainnetHeader.status).toBe(403);
    expect(await preprodKeyMainnetHeader.json()).toMatchObject({
      kind: CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH,
    });
  });

  it("answers 400 network_unknown for an unknown header value", async () => {
    const app = buildApp();
    for (const value of ["testnet", "", "Mainnet"]) {
      const response = await app.request("/check", {
        headers: { [NETWORK_HEADER]: value },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        kind: CORE_API_ERROR_KINDS.NETWORK_UNKNOWN,
      });
    }
  });

  it("gates only the named methods in requireMainnetOnlyFeatureForMethods", async () => {
    const app = buildApp(undefined, ["POST"]);

    const getRes = await app.request("/check", {
      method: "GET",
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(getRes.status).toBe(200);

    const headRes = await app.request("/check", {
      method: "HEAD",
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(headRes.status).toBe(200);
    expect(await headRes.text()).toBe("");

    const postRes = await app.request("/check", {
      method: "POST",
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(postRes.status).toBe(422);
    expect(await postRes.json()).toMatchObject({
      kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
    });
  });

  it("refuses implicit HEAD on GET rules under preprod without running the handler and preserves HEAD on Mainnet", async () => {
    let handlerCalls = 0;
    const app = new Hono();
    app.onError(errorHandler);
    app.use("*", requireMainnetOnlyFeatureForMethods(["GET"]));
    app.get("/check", (c) => {
      handlerCalls += 1;
      return c.json({ ok: true });
    });

    const preprodHead = await app.request("/check", {
      method: "HEAD",
      headers: { [NETWORK_HEADER]: "preprod" },
    });
    expect(preprodHead.status).toBe(422);
    expect(await preprodHead.text()).toBe("");
    expect(preprodHead.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(handlerCalls).toBe(0);

    const mainnetHead = await app.request("/check", { method: "HEAD" });
    expect(mainnetHead.status).toBe(200);
    expect(await mainnetHead.text()).toBe("");
    expect(mainnetHead.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(handlerCalls).toBe(1);
  });
});
