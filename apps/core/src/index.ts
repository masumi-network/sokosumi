// import { Hono } from "hono";
// import { cors } from "hono/cors";
// import { logger } from "hono/logger";
// import type { RequestIdVariables } from "hono/request-id";
// import { requestId } from "hono/request-id";

// import { notFound } from "./helpers/error";
// import apiV1 from "./routes/v1";

// const app = new Hono<{ Variables: RequestIdVariables }>();

// app.use(logger());
// app.use(requestId());
// app.use("*", cors());

// app.notFound(() => {
//   throw notFound();
// });

// // Mount API v1 routes
// app.route("/v1", apiV1);

// export default {
//   port: process.env.PORT ?? 3000,
//   fetch: app.fetch,
// };

import { Hono } from "hono";

const app = new Hono();

const welcomeStrings = [
  `Hello Hono from Bun ${process.versions.bun}!`,
  "To learn more about Hono + Bun on Vercel, visit https://vercel.com/docs/frameworks/backend/hono",
];

app.get("/", (c) => {
  return c.text(welcomeStrings.join("\n\n"));
});

export default app;
