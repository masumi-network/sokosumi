"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_hono4 = require("hono");
var import_cors = require("hono/cors");
var import_logger = require("hono/logger");
var import_request_id2 = require("hono/request-id");

// src/config/env.ts
var import_dotenv = require("dotenv");
var z = __toESM(require("zod"));
(0, import_dotenv.config)();
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
var import_zod_openapi = require("@hono/zod-openapi");
var import_http_exception = require("hono/http-exception");
var errorResponseSchema = import_zod_openapi.z.object({
  /** Machine-readable error identifier */
  error: import_zod_openapi.z.string().openapi({ example: "Unauthorized" }),
  /** Human-readable description of the error */
  message: import_zod_openapi.z.string().openapi({ example: "Authentication required" }),
  /** Metadata about the request and response */
  meta: import_zod_openapi.z.object({
    /** ISO timestamp when the error was generated */
    timestamp: import_zod_openapi.z.iso.datetime().openapi({ example: "2025-01-01T12:00:00.000Z" }),
    requestId: import_zod_openapi.z.string().openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" }),
    path: import_zod_openapi.z.string().openapi({ example: "/v1/agents" }),
    method: import_zod_openapi.z.string().openapi({ example: "GET" })
  })
}).openapi("ErrorResponse");
function createHTTPException(status, message) {
  return new import_http_exception.HTTPException(status, { message });
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
var import_swagger_ui = require("@hono/swagger-ui");
var import_zod_openapi11 = require("@hono/zod-openapi");

// src/helpers/error-handler.ts
var import_http_exception2 = require("hono/http-exception");
function errorHandler(error, c) {
  const meta = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    requestId: c.var.requestId,
    path: c.req.path,
    method: c.req.method
  };
  if (error instanceof import_http_exception2.HTTPException) {
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
var import_zod_openapi2 = require("@hono/zod-openapi");
var import_hono = require("hono");
var import_request_id = require("hono/request-id");

// src/middleware/auth.ts
var import_bearer_auth = require("hono/bearer-auth");

// src/lib/auth.ts
var import_client = __toESM(require("@sokosumi/database/client"));
var import_better_auth = require("better-auth");
var import_prisma = require("better-auth/adapters/prisma");
var import_plugins = require("better-auth/plugins");
var auth = (0, import_better_auth.betterAuth)({
  database: (0, import_prisma.prismaAdapter)(import_client.default, {
    provider: "postgresql"
  }),
  secret: getEnvSecrets().BETTER_AUTH_SECRET,
  baseURL: getEnvSecrets().BETTER_AUTH_URL,
  rateLimit: {
    storage: "database"
  },
  plugins: [
    (0, import_plugins.apiKey)({
      rateLimit: {
        enabled: true,
        timeWindow: 60,
        // 60 seconds
        maxRequests: 100
        // 100 requests per minute
      },
      enableMetadata: true
    }),
    (0, import_plugins.organization)({
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
var bearerMiddleware = (0, import_bearer_auth.bearerAuth)({
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
var OpenAPIHonoWithAuth = class extends import_zod_openapi2.OpenAPIHono {
  constructor() {
    super();
    this.use((0, import_request_id.requestId)());
    this.use(authMiddleware);
  }
};

// src/routes/v1/agents/[id]/get.ts
var import_zod_openapi6 = require("@hono/zod-openapi");
var import_repositories = require("@sokosumi/database/repositories");

// src/helpers/openapi.ts
var import_zod_openapi4 = require("@hono/zod-openapi");

// src/helpers/response.ts
var import_zod_openapi3 = require("@hono/zod-openapi");
var successResponseSchema = (dataSchema) => import_zod_openapi3.z.object({
  /** The actual response data */
  data: dataSchema,
  /** Metadata about the response */
  meta: import_zod_openapi3.z.object({
    /** ISO timestamp when the response was generated */
    timestamp: import_zod_openapi3.z.iso.datetime(),
    // .openapi({ example: "2025-01-01T12:00:00.000Z" }),
    // Room for future additions: pagination, requestId, version, etc.
    requestId: import_zod_openapi3.z.string().openapi({ example: "5091b3ea-994f-4417-8e04-2efc05dd8673" })
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
var import_zod_openapi5 = require("@hono/zod-openapi");
var agentSchema = import_zod_openapi5.z.object({
  id: import_zod_openapi5.z.string().openapi({ example: "agent_123" }),
  name: import_zod_openapi5.z.string().openapi({ example: "Research Assistant" })
}).openapi("Agent");

// src/routes/v1/agents/[id]/get.ts
var params = import_zod_openapi6.z.object({
  id: import_zod_openapi6.z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i"
  })
});
var route = (0, import_zod_openapi6.createRoute)({
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
    const data = await import_repositories.agentRepository.getAgentWithRelationsById(id);
    if (!data) {
      throw notFound("Agent not found");
    }
    return ok(c, agentSchema.parse(data));
  });
}

// src/routes/v1/agents/get.ts
var import_zod_openapi7 = require("@hono/zod-openapi");
var import_repositories2 = require("@sokosumi/database/repositories");
var agentSchema2 = import_zod_openapi7.z.object({
  id: import_zod_openapi7.z.string().openapi({ example: "agent_123" }),
  name: import_zod_openapi7.z.string().openapi({ example: "Research Assistant" })
}).openapi("Agent");
var agentsSchema = import_zod_openapi7.z.array(agentSchema2);
var route2 = (0, import_zod_openapi7.createRoute)({
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
    const agents = await import_repositories2.agentRepository.getAgentsWithRelations();
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
var import_zod_openapi9 = require("@hono/zod-openapi");
var import_repositories3 = require("@sokosumi/database/repositories");

// src/routes/v1/users/schemas.ts
var import_zod_openapi8 = require("@hono/zod-openapi");
var userSchema = import_zod_openapi8.z.object({
  id: import_zod_openapi8.z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
  name: import_zod_openapi8.z.string().openapi({ example: "John Doe" }),
  email: import_zod_openapi8.z.string().openapi({ example: "john.doe@example.com" })
}).openapi("User");

// src/routes/v1/users/[id]/get.ts
var params2 = import_zod_openapi9.z.object({
  id: import_zod_openapi9.z.string().openapi({
    param: { name: "id", in: "path" },
    example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj"
  })
});
var route3 = (0, import_zod_openapi9.createRoute)({
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
    const userRecord = await import_repositories3.userRepository.getUserById(id);
    if (!userRecord) {
      throw notFound("User not found");
    }
    return ok(c, userSchema.parse(userRecord));
  });
}

// src/routes/v1/users/me/get.ts
var import_zod_openapi10 = require("@hono/zod-openapi");
var import_repositories4 = require("@sokosumi/database/repositories");
var route4 = (0, import_zod_openapi10.createRoute)({
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
    const userRecord = await import_repositories4.userRepository.getUserById(user.id);
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
var app3 = new import_zod_openapi11.OpenAPIHono();
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
  (0, import_swagger_ui.swaggerUI)({
    url: "openapi.json",
    persistAuthorization: true,
    withCredentials: true,
    tryItOutEnabled: true
  })
);
var v1_default = app3;

// src/index.ts
var app4 = new import_hono4.Hono();
app4.use((0, import_logger.logger)());
app4.use((0, import_request_id2.requestId)());
app4.use("*", (0, import_cors.cors)());
app4.notFound(() => {
  throw notFound();
});
app4.get("/", (c) => c.text("Hello World!"));
app4.route("/v1", v1_default);
var index_default = {
  port: getEnvSecrets().PORT,
  fetch: app4.fetch
};
//# sourceMappingURL=index.js.map