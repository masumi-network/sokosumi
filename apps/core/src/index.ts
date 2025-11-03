import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import {
  type ErrorOptions,
  type ErrorResponse,
  getErrorName,
} from "./helpers/error";
import agentsRouter from "./routes/agents";

const app = new Hono();
app.use(logger());

// Centralized error handler
app.onError((error, c) => {
  console.log("test");
  if (error instanceof HTTPException) {
    const status = error.status;
    const options = error.cause as ErrorOptions | undefined;

    const errorResponse: ErrorResponse = {
      error: getErrorName(status),
      message: error.message,
      code: options?.code,
      details: options?.details,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: options?.requestId || c.req.header("x-request-id"),
        path: options?.path || c.req.path,
      },
    };

    return c.json(errorResponse, status);
  }

  // Handle unexpected errors
  return c.json(
    {
      error: "InternalServerError",
      message: "An unexpected error occurred",
      meta: {
        timestamp: new Date().toISOString(),
      },
    },
    500,
  );
});

// Mount agents routes at /api/v1/
app.route("/api/v1", agentsRouter);

export default {
  port: 3001,
  fetch: app.fetch,
};
