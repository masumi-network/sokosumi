import { OpenAPIHono } from "@hono/zod-openapi";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountAcceptInviteLink from "./[token]/accept/post.js";
import mountResolveInviteLink from "./[token]/get.js";

// GET /{token} is public — the token is the capability, so the /join preview
// renders while logged out. It must NOT sit on OpenAPIHonoWithAuth, whose auth
// middleware rejects every anonymous request.
const publicRoutes = new OpenAPIHono();
mountResolveInviteLink(publicRoutes);

// POST /{token}/accept requires a signed-in caller; the auth stack runs here.
const authedRoutes = new OpenAPIHonoWithAuth();
mountAcceptInviteLink(authedRoutes);

const app = new OpenAPIHono();
app.route("/", publicRoutes);
app.route("/", authedRoutes);

export default app;
