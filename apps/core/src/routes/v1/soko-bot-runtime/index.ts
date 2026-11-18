import { OpenAPIHono, z } from "@hono/zod-openapi";
import { SOKO_BOT_TURN_TOKEN_HEADER } from "@sokosumi/soko-bot";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { badRequest, unauthorized, unprocessableEntity } from "@/helpers/error";
import { databaseNow } from "@/lib/db/database-now";
import { tryUseLogger } from "@/lib/evlog";
import { runnerDiagnostic } from "@/lib/soko-bot/runner-log-events";
import {
  type TurnTokenClaims,
  verifyTurnToken,
} from "@/lib/soko-bot/sandbox/turn-token";
import {
  completeSandboxTurn,
  failSandboxTurn,
  grantSandboxUpload,
  proxySandboxModelCall,
  recordSandboxAction,
  recordSandboxActionResult,
  recordSandboxReasoning,
  runSandboxTool,
  sandboxFileSource,
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
  /** The model's call id; a script in the sandbox may leave it out. */
  toolCallId: z.string().min(1).max(200).optional(),
  input: z.unknown(),
});
const actionSchema = z.object({
  name: z.string().min(1).max(64),
  toolCallId: z.string().min(1).max(200),
  input: z.unknown().optional(),
  status: z.enum(["completed", "failed"]).optional(),
  output: z.string().max(10_000).optional(),
  sources: z.array(z.string().max(2_000)).max(50).optional(),
});
const uploadSchema = z.object({
  filename: z.string().min(1).max(200),
  folder: z.string().trim().min(1).max(200).optional(),
  contentType: z.string().max(120).optional(),
  size: z.number().int().positive(),
});
const completeSchema = z.object({
  text: z.string().max(200_000),
  finishReason: z.string().max(64),
});
/** One model step's reasoning summary, as the provider returned it. */
const reasoningSchema = z.object({ text: z.string().min(1).max(20_000) });
const failSchema = z.object({
  code: z.string().max(100),
  message: z.string().max(2_000),
  /** Checked on its own: a bad diagnostic must not keep the turn running. */
  diagnostic: z.unknown().optional(),
});

app.use("/turns/:turnId/*", async (c, next) => {
  const claims = await verifyTurnToken(
    c.req.header(SOKO_BOT_TURN_TOKEN_HEADER),
    c.req.param("turnId"),
    async () => (await databaseNow()).getTime(),
  );
  if (!claims) throw unauthorized();
  c.set("turn", claims);
  // Verified, so the request's event joins the runner's own by turn.
  tryUseLogger()?.set({ turnId: claims.turnId });
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

app.post("/turns/:turnId/files", async (c) =>
  c.json(
    await sandboxFileSource(
      c.get("turn"),
      (await parseJsonBody(c, z.object({ fileId: z.uuid() }))).fileId,
    ),
  ),
);

app.post("/turns/:turnId/uploads", async (c) =>
  c.json(
    await grantSandboxUpload(
      c.get("turn"),
      await parseJsonBody(c, uploadSchema),
    ),
  ),
);

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

app.post("/turns/:turnId/reasoning", async (c) => {
  const { text } = await parseJsonBody(c, reasoningSchema);
  await recordSandboxReasoning(c.get("turn"), text);
  return c.json({ ok: true });
});

app.post("/turns/:turnId/gateway/language-model", async (c) => {
  const proxied = await proxySandboxModelCall(c.get("turn"), {
    headers: c.req.raw.headers,
    body: await c.req.text(),
  });
  return new Response(proxied.body, {
    status: proxied.status,
    headers: { "content-type": proxied.contentType },
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
  const { diagnostic, ...failure } = await parseJsonBody(c, failSchema);
  // Anything in the sandbox can post here, user code included: a diagnostic
  // off the closed sets is dropped whole, and the turn still fails.
  await failSandboxTurn(
    c.get("turn"),
    failure,
    runnerDiagnostic(diagnostic) ?? undefined,
  );
  return c.json({ ok: true });
});

export default app;
