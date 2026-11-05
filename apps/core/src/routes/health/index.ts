import { Hono } from "hono";

import { ok } from "@/helpers/response";

const app = new Hono();

// Liveness only: no auth and no database call, so a probe tells "the process
// answers" apart from "Postgres is slow". Maintenance mode still answers 503.
app.get("/", (c) => ok(c, { status: "ok" as const }));

export default app;
