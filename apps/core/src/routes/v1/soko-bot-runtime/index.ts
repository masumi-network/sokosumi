import { OpenAPIHono, z } from "@hono/zod-openapi";
import { SOKO_BOT_TURN_TOKEN_HEADER } from "@sokosumi/soko-bot";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { badRequest, unauthorized, unprocessableEntity } from "@/helpers/error";
import {
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
  startSandboxTurn,
} from "@/services/soko-bot-sandbox-turn.service";

/**
 * The surface a sandbox runner calls: machine-to-machine and not part of the
 * web client, so it stays out of the OpenAPI document. Every request carries a
 * per-turn token the sandbox network proxy adds, scoped to the turn in the
 * path and expiring with it. Errors use the standard envelope.
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
  output: z.string().max(10_000).optional(),
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
    c.req.header(SOKO_BOT_TURN_TOKEN_HEADER),
    c.req.param("turnId"),
  );
  if (!claims) throw unauthorized();
  c.set("turn", claims);
  await next();
});

async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest("Invalid request body");
  return parsed.data;
}

app.post("/turns/:turnId/start", async (c) =>
  c.json(await startSandboxTurn(c.get("turn"))),
);

app.post("/turns/:turnId/tools/:capability", async (c) => {
  const call = await parseJsonBody(c, toolCallSchema);
  try {
    const result = await runSandboxTool(c.get("turn"), {
      capability: c.req.param("capability"),
      toolCallId: call.toolCallId,
      toolInput: call.input,
    });
    return c.json({ result: result ?? null });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    // A refused or failed tool is the model's to read, not a transport error.
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Tool failed",
    );
  }
});

app.post("/turns/:turnId/actions", async (c) => {
  const action = await parseJsonBody(c, actionSchema);
  await recordSandboxAction(c.get("turn"), {
    name: action.name,
    toolCallId: action.toolCallId,
    toolInput: action.input,
  });
  return c.json({ ok: true });
});

app.post("/turns/:turnId/actions/result", async (c) => {
  const action = await parseJsonBody(c, actionSchema);
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
  await completeSandboxTurn(
    c.get("turn"),
    await parseJsonBody(c, completeSchema),
  );
  return c.json({ ok: true });
});

app.post("/turns/:turnId/fail", async (c) => {
  await failSandboxTurn(c.get("turn"), await parseJsonBody(c, failSchema));
  return c.json({ ok: true });
});

export default app;
