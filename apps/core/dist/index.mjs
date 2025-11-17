// src/index.ts
import { Hono as Hono2 } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId as requestId2 } from "hono/request-id";

// src/config/env.ts
import { config } from "dotenv";
import * as z from "zod";
config();
var envSecretsSchema = z.object({
  // Authentication
  API_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  // Database
  DATABASE_URL: z.url(),
  // General
  PORT: z.coerce.number().min(1).max(65535).default(3e3)
});
var envSecrets;
function validateEnv() {
  const parsedSecrets = envSecretsSchema.safeParse(process.env);
  if (!parsedSecrets.success) {
    console.error(
      "\u274C Invalid environment secrets:",
      z.treeifyError(parsedSecrets.error)
    );
    process.exit(1);
  }
  envSecrets = parsedSecrets.data;
}
function getEnvSecrets() {
  if (!envSecrets) {
    validateEnv();
  }
  return envSecrets;
}

// src/helpers/error.ts
import { z as z2 } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
var errorResponseSchema = z2.object({
  /** Machine-readable error identifier */
  error: z2.string().openapi({ example: "Unauthorized" }),
  /** Human-readable description of the error */
  message: z2.string().openapi({ example: "Authentication required" }),
  /** Metadata about the request and response */
  meta: z2.object({
    /** ISO timestamp when the error was generated */
    timestamp: z2.iso.datetime().openapi({ example: "2025-01-01T12:00:00.000Z" }),
    requestId: z2.string().openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" }),
    path: z2.string().openapi({ example: "/v1/agents" }),
    method: z2.string().openapi({ example: "GET" })
  })
}).openapi("ErrorResponse");
function createHTTPException(status, message) {
  return new HTTPException(status, { message });
}
var unauthorized = (message = "Unauthorized") => {
  return createHTTPException(401, message);
};
var forbidden = (message = "Forbidden") => {
  return createHTTPException(403, message);
};
var notFound = (message = "Not Found") => {
  return createHTTPException(404, message);
};
function getErrorName(status) {
  const errorNames = {
    400: "BadRequest",
    401: "Unauthorized",
    403: "Forbidden",
    404: "NotFound",
    409: "Conflict",
    422: "UnprocessableEntity",
    429: "TooManyRequests",
    500: "InternalServerError",
    503: "ServiceUnavailable"
  };
  return errorNames[status] || "Error";
}

// src/routes/v1/index.ts
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono as OpenAPIHono2 } from "@hono/zod-openapi";

// src/helpers/error-handler.ts
import { HTTPException as HTTPException2 } from "hono/http-exception";
function errorHandler(error, c) {
  const meta = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    requestId: c.var.requestId,
    path: c.req.path,
    method: c.req.method
  };
  if (error instanceof HTTPException2) {
    const status = error.status;
    const errorResponse = {
      error: getErrorName(status),
      message: error.message,
      meta
    };
    return c.json(errorResponse, status);
  }
  return c.json(
    {
      error: "InternalServerError",
      message: "An unexpected error occurred",
      meta
    },
    500
  );
}

// src/lib/hono.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

// src/middleware/auth.ts
import { bearerAuth } from "hono/bearer-auth";

// src/lib/auth.ts
import prisma from "@sokosumi/database/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { apiKey, organization } from "better-auth/plugins";
var auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql"
  }),
  secret: getEnvSecrets().BETTER_AUTH_SECRET,
  baseURL: getEnvSecrets().BETTER_AUTH_URL,
  rateLimit: {
    storage: "database"
  },
  plugins: [
    apiKey({
      rateLimit: {
        enabled: true,
        timeWindow: 60,
        // 60 seconds
        maxRequests: 100
        // 100 requests per minute
      },
      enableMetadata: true
    }),
    organization({
      allowUserToCreateOrganization(user) {
        return user.emailVerified;
      },
      cancelPendingInvitationsOnReInvite: true,
      schema: {
        organization: {
          additionalFields: {
            stripeCustomerId: {
              type: "string",
              required: false,
              defaultValue: null,
              input: false
            },
            invoiceEmail: {
              type: "string",
              required: false,
              defaultValue: null,
              input: false
            }
          }
        }
      }
    })
  ],
  user: {
    additionalFields: {
      termsAccepted: {
        type: "boolean",
        required: true,
        defaultValue: true
      },
      marketingOptIn: {
        type: "boolean",
        required: true,
        defaultValue: true
      },
      jobStatusNotificationsOptIn: {
        type: "boolean",
        required: false,
        defaultValue: true
      },
      stripeCustomerId: {
        type: "string",
        required: false,
        defaultValue: null
      },
      onboardingCompleted: {
        type: "boolean",
        required: true,
        defaultValue: false
      },
      imageHash: {
        type: "string",
        required: false
      }
    }
  }
});

// src/middleware/auth.ts
function setAuthContext(c, context) {
  c.set("isAuthenticated", context.isAuthenticated);
  c.set("user", context.user);
}
var bearerMiddleware = bearerAuth({
  verifyToken: async (token, c) => {
    if (token === getEnvSecrets().API_KEY) {
      setAuthContext(c, { isAuthenticated: true, user: void 0 });
      return true;
    }
    const result = await auth.api.verifyApiKey({
      body: { key: token }
    });
    if (result.valid && result.key) {
      setAuthContext(c, {
        isAuthenticated: true,
        user: {
          id: result.key.userId,
          organizationId: result.key.metadata?.organizationId ?? null
        }
      });
      return true;
    }
    throw unauthorized("Invalid token");
  }
});
var sessionMiddleware = async (c, next) => {
  const response = await auth.api.getSession({
    headers: c.req.raw.headers
  });
  if (response?.session && response.user) {
    const { session, user } = response;
    setAuthContext(c, {
      isAuthenticated: true,
      user: {
        id: user.id,
        organizationId: session.activeOrganizationId ?? null
      }
    });
    await next();
  }
  throw unauthorized();
};
var authMiddleware = async (c, next) => {
  const authHeader = c.req.header("authorization");
  if (authHeader) {
    await bearerMiddleware(c, next);
  } else {
    await sessionMiddleware(c, next);
  }
};

// src/lib/hono.ts
var OpenAPIHonoWithAuth = class extends OpenAPIHono {
  constructor() {
    super();
    this.use(requestId());
    this.use(authMiddleware);
  }
};

// src/routes/v1/agents/[id]/get.ts
import { createRoute, z as z6 } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";

// src/helpers/openapi.ts
import "@hono/zod-openapi";

// src/helpers/response.ts
import { z as z3 } from "@hono/zod-openapi";
var successResponseSchema = (dataSchema) => z3.object({
  /** The actual response data */
  data: dataSchema,
  /** Metadata about the response */
  meta: z3.object({
    /** ISO timestamp when the response was generated */
    timestamp: z3.iso.datetime(),
    // .openapi({ example: "2025-01-01T12:00:00.000Z" }),
    // Room for future additions: pagination, requestId, version, etc.
    requestId: z3.string().openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" })
  })
}).openapi("SuccessResponse");
var ok = (c, data) => {
  return c.json(
    {
      data,
      meta: {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId: c.var.requestId
      }
    },
    200
  );
};

// src/helpers/openapi.ts
function jsonContent(schema) {
  return {
    "application/json": {
      schema
    }
  };
}
function jsonSuccessResponse(schema, description) {
  return {
    description,
    content: jsonContent(successResponseSchema(schema))
  };
}
function jsonErrorResponse(description) {
  return {
    description,
    content: jsonContent(errorResponseSchema)
  };
}

// src/routes/v1/agents/schemas.ts
import { z as z5 } from "@hono/zod-openapi";
var agentSchema = z5.object({
  id: z5.string().openapi({ example: "agent_123" }),
  name: z5.string().openapi({ example: "Research Assistant" })
}).openapi("Agent");

// src/routes/v1/agents/[id]/get.ts
var params = z6.object({
  id: z6.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i"
  })
});
var route = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Agents"],
  request: {
    params
  },
  responses: {
    200: jsonSuccessResponse(agentSchema, "Retrieve the agent by ID"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found")
  }
});
function mount(app5) {
  app5.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const data = await agentRepository.getAgentWithRelationsById(id);
    if (!data) {
      throw notFound("Agent not found");
    }
    return ok(c, agentSchema.parse(data));
  });
}

// src/routes/v1/agents/get.ts
import { createRoute as createRoute2, z as z7 } from "@hono/zod-openapi";
import { agentRepository as agentRepository2 } from "@sokosumi/database/repositories";
var agentSchema2 = z7.object({
  id: z7.string().openapi({ example: "agent_123" }),
  name: z7.string().openapi({ example: "Research Assistant" })
}).openapi("Agent");
var agentsSchema = z7.array(agentSchema2);
var route2 = createRoute2({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found")
  }
});
function mount2(app5) {
  app5.openapi(route2, async (c) => {
    const agents = await agentRepository2.getAgentsWithRelations();
    if (!agents) {
      throw notFound("No agents found");
    }
    return ok(c, agentsSchema.parse(agents));
  });
}

// src/routes/v1/agents/index.ts
var app = new OpenAPIHonoWithAuth();
mount2(app);
mount(app);
var agents_default = app;

// src/routes/v1/users/[id]/get.ts
import { createRoute as createRoute3, z as z9 } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

// src/routes/v1/users/schemas.ts
import { z as z8 } from "@hono/zod-openapi";
var userSchema = z8.object({
  id: z8.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
  name: z8.string().openapi({ example: "John Doe" }),
  email: z8.string().openapi({ example: "john.doe@example.com" })
}).openapi("User");

// src/routes/v1/users/[id]/get.ts
var params2 = z9.object({
  id: z9.string().openapi({
    param: { name: "id", in: "path" },
    example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj"
  })
});
var route3 = createRoute3({
  method: "get",
  path: "/{id}",
  tags: ["Users"],
  request: {
    params: params2
  },
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the user by ID"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found")
  }
});
function mount3(app5) {
  app5.openapi(route3, async (c) => {
    const { user } = c.var;
    const { id } = c.req.valid("param");
    if (user && user.id !== id) {
      throw forbidden("You can only access your own user data");
    }
    const userRecord = await userRepository.getUserById(id);
    if (!userRecord) {
      throw notFound("User not found");
    }
    return ok(c, userSchema.parse(userRecord));
  });
}

// src/routes/v1/users/me/get.ts
import { createRoute as createRoute4 } from "@hono/zod-openapi";
import { userRepository as userRepository2 } from "@sokosumi/database/repositories";
var route4 = createRoute4({
  method: "get",
  path: "/me",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the current user"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found")
  }
});
function mount4(app5) {
  app5.openapi(route4, async (c) => {
    const user = c.var.user;
    if (!user) {
      throw forbidden("A non-user cannot access their own data");
    }
    const userRecord = await userRepository2.getUserById(user.id);
    if (!userRecord) {
      throw notFound("User not found");
    }
    return ok(c, userSchema.parse(userRecord));
  });
}

// src/routes/v1/users/index.ts
var app2 = new OpenAPIHonoWithAuth();
mount4(app2);
mount3(app2);
var users_default = app2;

// src/routes/v1/index.ts
var app3 = new OpenAPIHono2();
app3.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT"
});
app3.onError(errorHandler);
app3.route("/agents", agents_default);
app3.route("/users", users_default);
app3.doc("/openapi.json", {
  openapi: "3.0.3",
  info: {
    version: "1.0.0",
    title: "Sokosumi API"
  },
  servers: [
    {
      url: `http://localhost:${getEnvSecrets().PORT.toString()}/v1`,
      description: "Local Server"
    }
  ],
  security: [{ bearerAuth: [] }]
});
app3.get(
  "/doc",
  swaggerUI({
    url: "openapi.json",
    persistAuthorization: true,
    withCredentials: true,
    tryItOutEnabled: true
  })
);
var v1_default = app3;

// src/index.ts
var app4 = new Hono2();
app4.use(logger());
app4.use(requestId2());
app4.use("*", cors());
app4.notFound(() => {
  throw notFound();
});
app4.get("/", (c) => c.text("Hello World!"));
app4.route("/v1", v1_default);
var index_default = {
  port: getEnvSecrets().PORT,
  fetch: app4.fetch
};
export {
  index_default as default
};
//# sourceMappingURL=index.mjs.map