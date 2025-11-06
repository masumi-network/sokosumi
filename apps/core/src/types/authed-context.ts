import type { Context } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import type { AuthContext } from "@/middleware/auth";

export type AuthedContext = Context<{
  Variables: { auth: AuthContext } & RequestIdVariables;
}>;

export type RequestIdContext = Context<{
  Variables: RequestIdVariables;
}>;
