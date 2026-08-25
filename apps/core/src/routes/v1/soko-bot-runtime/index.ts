import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { isSokoBotCapability } from "@sokosumi/soko-bot";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";

import {
  badRequest,
  conflict,
  errorResponseWithExtensionsSchema,
  forbidden,
  internalServerError,
  notFound,
  payloadTooLarge,
  unauthorized,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonContent, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { defaultValidationHook } from "@/lib/hono";

import {
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
  sokoBotRuntimeService,
} from "@/services/soko-bot-runtime.service";

const runtimeRequestSchema = z
  .object({
    turnId: z.string().uuid(),
    sessionId: z.string().min(1),
  })
  .strict();

const toolRequestSchema = runtimeRequestSchema
  .extend({
    capability: z.string().refine(isSokoBotCapability),
    toolCallId: z.string().min(1).max(200),
    input: z.unknown(),
  })
  .strict();

const runtimeHeadersSchema = z.object({
  authorization: z.string().min(1),
  "x-soko-bot-turn-grant": z.string().min(1),
});

const runtimeErrorSchema = errorResponseWithExtensionsSchema(
  { retryable: z.boolean() },
  "SokoBotRuntimeError",
);

const jsonObjectSchema = z.record(z.string(), z.unknown());
const runtimeVersionSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  systemPrompt: z.string(),
  skills: z.array(z.string()),
});

const runtimeContextResponseSchema = z.object({
  version: runtimeVersionSchema.optional(),
  packet: z.object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    hash: z.string(),
    trigger: jsonObjectSchema,
    actor: jsonObjectSchema,
    workspace: jsonObjectSchema,
    projects: z.array(jsonObjectSchema),
    tasks: z.array(jsonObjectSchema),
    coworkers: z.array(jsonObjectSchema),
    agents: z.array(jsonObjectSchema),
    jobs: z.array(jsonObjectSchema),
    pendingDecisions: z.array(jsonObjectSchema),
    recentTurns: z.array(jsonObjectSchema),
    memory: z.object({
      version: z.number().int().nonnegative(),
      hash: z.string().nullable(),
      markdown: z.string(),
    }),
    counts: z.record(z.string(), z.number().int().nonnegative()),
    omissions: z.record(z.string(), z.number().int().nonnegative()),
  }),
  hash: z.string(),
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string().datetime(),
});
const runtimeToolResultResponseSchema = z.union([
  jsonObjectSchema,
  z.array(z.unknown()),
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const app = new OpenAPIHono({ defaultHook: defaultValidationHook });
const RUNTIME_REQUEST_MAX_BYTES = 256 * 1_024;

app.use(
  "*",
  bodyLimit({
    maxSize: RUNTIME_REQUEST_MAX_BYTES,
    onError: () => {
      throw payloadTooLarge(
        "Soko Bot runtime request exceeded byte limit",
        runtimeMetadata("payload_too_large", false),
      );
    },
  }),
);

function requiredBearer(value: string | undefined): string {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1])
    throw new SokoBotRuntimeAuthorizationError("Missing OIDC bearer");
  return match[1];
}

function requiredGrant(value: string | undefined): string {
  if (!value) throw new SokoBotRuntimeAuthorizationError("Missing turn grant");
  return value;
}

function runtimeAuth(c: { req: { header(name: string): string | undefined } }) {
  return {
    oidcToken: requiredBearer(c.req.header("authorization")),
    turnGrant: requiredGrant(c.req.header("x-soko-bot-turn-grant")),
  };
}

function runtimeMetadata(kind: string, retryable: boolean) {
  return { kind, extensions: { retryable } };
}

function throwRuntimeError(error: unknown): never {
  if (error instanceof SokoBotRuntimeAuthorizationError) {
    throw unauthorized(error.message, runtimeMetadata("unauthorized", false));
  }
  if (error instanceof SokoBotRuntimeConflictError) {
    throw conflict(error.message, runtimeMetadata("conflict", false));
  }
  if (
    error instanceof SokoBotRuntimeValidationError ||
    error instanceof z.ZodError
  ) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid request",
      runtimeMetadata("validation", false),
    );
  }
  if (error instanceof HTTPException) {
    const metadata = runtimeMetadata("tool_rejected", false);
    switch (error.status) {
      case 400:
        throw badRequest(error.message, metadata);
      case 401:
        throw unauthorized(error.message, metadata);
      case 403:
        throw forbidden(error.message, metadata);
      case 404:
        throw notFound(error.message, metadata);
      case 409:
        throw conflict(error.message, metadata);
      case 422:
        throw unprocessableEntity(error.message, metadata);
    }
  }
  console.error("Soko Bot runtime tool failed", error);
  throw internalServerError(
    "Sokosumi did not complete this operation. Do not report success; the user may retry.",
    runtimeMetadata("tool_execution_failed", true),
  );
}

const contextRoute = createRoute({
  method: "post",
  path: "/context",
  operationId: "getSokoBotRuntimeContext",
  tags: ["Soko Bot Runtime"],
  request: {
    headers: runtimeHeadersSchema,
    body: { content: { "application/json": { schema: runtimeRequestSchema } } },
  },
  responses: {
    200: jsonSuccessResponse(
      runtimeContextResponseSchema,
      "Bound turn Context snapshot",
    ),
    401: {
      description: "Unauthorized",
      content: jsonContent(runtimeErrorSchema),
    },
    409: { description: "Conflict", content: jsonContent(runtimeErrorSchema) },
    413: {
      description: "Payload too large",
      content: jsonContent(runtimeErrorSchema),
    },
    422: {
      description: "Validation error",
      content: jsonContent(runtimeErrorSchema),
    },
    500: {
      description: "Internal error",
      content: jsonContent(runtimeErrorSchema),
    },
  },
});

app.openapi(contextRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const context = await sokoBotRuntimeService.getContext({
      ...runtimeAuth(c),
      ...body,
    });
    return ok(
      c,
      runtimeContextResponseSchema.parse({
        ...context,
        generatedAt: context.generatedAt.toISOString(),
      }),
    );
  } catch (error) {
    throwRuntimeError(error);
  }
});

const skillsRoute = createRoute({
  method: "post",
  path: "/skills",
  operationId: "getSokoBotRuntimeSkills",
  tags: ["Soko Bot Runtime"],
  request: {
    headers: runtimeHeadersSchema,
    body: { content: { "application/json": { schema: runtimeRequestSchema } } },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({
        skills: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            markdown: z.string(),
          }),
        ),
      }),
      "Owner-installed skills for this turn",
    ),
    401: {
      description: "Unauthorized",
      content: jsonContent(runtimeErrorSchema),
    },
    500: {
      description: "Internal error",
      content: jsonContent(runtimeErrorSchema),
    },
  },
});

app.openapi(skillsRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    return ok(
      c,
      await sokoBotRuntimeService.getInstalledSkills({
        ...runtimeAuth(c),
        ...body,
      }),
    );
  } catch (error) {
    throwRuntimeError(error);
  }
});

const executeToolRoute = createRoute({
  method: "post",
  path: "/tools/execute",
  operationId: "executeSokoBotRuntimeTool",
  tags: ["Soko Bot Runtime"],
  request: {
    headers: runtimeHeadersSchema,
    body: { content: { "application/json": { schema: toolRequestSchema } } },
  },
  responses: {
    200: jsonSuccessResponse(
      runtimeToolResultResponseSchema,
      "Tool execution result",
    ),
    400: {
      description: "Bad request",
      content: jsonContent(runtimeErrorSchema),
    },
    401: {
      description: "Unauthorized",
      content: jsonContent(runtimeErrorSchema),
    },
    403: {
      description: "Forbidden",
      content: jsonContent(runtimeErrorSchema),
    },
    404: {
      description: "Not found",
      content: jsonContent(runtimeErrorSchema),
    },
    409: {
      description: "Conflict",
      content: jsonContent(runtimeErrorSchema),
    },
    413: {
      description: "Payload too large",
      content: jsonContent(runtimeErrorSchema),
    },
    422: {
      description: "Validation error",
      content: jsonContent(runtimeErrorSchema),
    },
    500: {
      description: "Tool execution failure",
      content: jsonContent(runtimeErrorSchema),
    },
  },
});

app.openapi(executeToolRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    if (!isSokoBotCapability(body.capability)) {
      throw new SokoBotRuntimeValidationError("Unknown capability");
    }
    const result = await sokoBotRuntimeService.executeTool({
      ...runtimeAuth(c),
      ...body,
      capability: body.capability,
    });
    return ok(
      c,
      runtimeToolResultResponseSchema.parse(
        JSON.parse(JSON.stringify(result)) as unknown,
      ),
    );
  } catch (error) {
    throwRuntimeError(error);
  }
});

export default app;
