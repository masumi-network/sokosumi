import { Hono } from "hono";
import agentsRouter from "./routes/agents";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// Mount agents routes at /api
app.route("/api", agentsRouter);

export default {
  port: 3001,
  fetch: app.fetch,
};
