import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  TURN_TOKEN_HEADER,
  type TurnTokenClaims,
  verifyTurnToken,
} from "@/lib/soko-bot/sandbox/turn-token";
import {
  completeSandboxTurn,
  failSandboxTurn,
  proxySandboxModelCall,
  recordSandboxAction,
  recordSandboxActionResult,
  runSandboxTool,
  SokoBotSandboxRequestError,
  startSandboxTurn,
} from "@/services/soko-bot-sandbox-turn.service";

/**
 * The surface a bot's sandbox runner calls. Not a session API and not part of
 * the web client: every request carries a per-turn token the sandbox network
 * proxy adds, scoped to the turn named in the path and expiring with it.
 */
const app = new OpenAPIHono<{ Variables: { turn: TurnTokenClaims } }>();

const toolCallSchema = z.object({
  toolCallId: z.string().min(1).max(200),
  input: z.unknown(),
});
const actionSchema = z.object({
  name: z.string().min(1).max(64),
  toolCallId: z.string().min(1).max(200),
  input: z.unknown().optional(),
});
const completeSchema = z.object({
  text: z.string().max(200_000),
  finishReason: z.string().max(64),
});
const failSchema = z.object({
  code: z.string().max(100),
  message: z.string().max(2_000),
});

app.use("/turns/:turnId/*", async (c, next) => {
  const claims = verifyTurnToken(
    c.req.header(TURN_TOKEN_HEADER),
    c.req.param("turnId"),
  );
  if (!claims) return c.json({ error: "Unauthorized" }, 401);
  c.set("turn", claims);
  await next();
});

app.onError((error, c) => {
  if (error instanceof SokoBotSandboxRequestError)
    return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return c.json({ error: "Invalid request" }, 400);
  console.error("Soko Bot runtime request failed", {
    path: c.req.path,
    error: error instanceof Error ? error.message : "unknown",
  });
  return c.json({ error: "Internal error" }, 500);
});

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await c.req.json());
}

app.post("/turns/:turnId/start", async (c) =>
  c.json(await startSandboxTurn(c.get("turn"))),
);

app.post("/turns/:turnId/tools/:capability", async (c) => {
  const call = await body(c, toolCallSchema);
  try {
    const result = await runSandboxTool(c.get("turn"), {
      capability: c.req.param("capability"),
      toolCallId: call.toolCallId,
      toolInput: call.input,
    });
    return c.json({ result: result ?? null });
  } catch (error) {
    if (error instanceof SokoBotSandboxRequestError) throw error;
    // A refused or failed tool is the model's to read, not a transport error.
    return c.json(
      { error: error instanceof Error ? error.message : "Tool failed" },
      422,
    );
  }
});

app.post("/turns/:turnId/actions", async (c) => {
  const action = await body(c, actionSchema);
  await recordSandboxAction(c.get("turn"), {
    name: action.name,
    toolCallId: action.toolCallId,
    toolInput: action.input,
  });
  return c.json({ ok: true });
});

app.post("/turns/:turnId/actions/result", async (c) => {
  const action = await body(c, actionSchema);
  await recordSandboxActionResult(c.get("turn"), action);
  return c.json({ ok: true });
});

app.post("/turns/:turnId/gateway/language-model", async (c) => {
  const proxied = await proxySandboxModelCall(c.get("turn"), {
    headers: c.req.raw.headers,
    body: await c.req.text(),
  });
  return new Response(proxied.body, {
    status: proxied.status,
    headers: { "content-type": "application/json" },
  });
});

app.post("/turns/:turnId/complete", async (c) => {
  await completeSandboxTurn(c.get("turn"), await body(c, completeSchema));
  return c.json({ ok: true });
});

app.post("/turns/:turnId/fail", async (c) => {
  await failSandboxTurn(c.get("turn"), await body(c, failSchema));
  return c.json({ ok: true });
});

export default app;
