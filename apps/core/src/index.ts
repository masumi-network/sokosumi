import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { notFound } from "./helpers/error";
import apiV1 from "./routes/v1";

const app = new Hono<{ Variables: RequestIdVariables }>();

app.use(logger());
app.use(requestId());
app.use("*", cors());

app.notFound(() => {
  throw notFound();
});

// Mount API v1 routes
app.route("/v1", apiV1);

// export default {
//   port: process.env.PORT ?? 3000,
//   fetch: app.fetch,
// };

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") || "World";

    return Response.json({ message: `Hello ${name}!` });
  },
};
