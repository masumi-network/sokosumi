import type { Context } from "hono";

import { unprocessableEntity } from "@/helpers/error";
import { tryUseLogger } from "@/lib/evlog";
import type { EnvVariables } from "@/lib/hono";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  isCoworkerAuthContext,
} from "@/middleware/auth";

export type RouteVars = EnvVariables["Variables"];
export type LegacyContext = Context<EnvVariables>;

/** EOD 2026-09-29 CEST (UTC+2): from here on every vendor gets the current API. */
export const LEGACY_VENDOR_SCHEDULES_SUNSET_AT = new Date(
  "2026-09-29T22:00:00.000Z",
);

/**
 * The Coworker auth of a vendor listed in `LEGACY_TASK_SCHEDULE_VENDOR_IDS`
 * (comma separated), else null. Read per request so tests can set it.
 */
export function legacyScheduleVendor(
  auth: AuthenticationContext,
): CoworkerAuthenticationContext | null {
  if (
    !isCoworkerAuthContext(auth) ||
    Date.now() >= LEGACY_VENDOR_SCHEDULES_SUNSET_AT.getTime()
  ) {
    return null;
  }
  const listed = (process.env.LEGACY_TASK_SCHEDULE_VENDOR_IDS ?? "")
    .split(",")
    .some((id) => id.trim() === auth.vendorId);
  return listed ? auth : null;
}

/** Every answer of this layer is logged, so the sunset can be checked. */
export function logLegacyScheduleHit(
  c: LegacyContext,
  path: string,
  mappedTarget: string,
): void {
  const auth = c.var.authContext;
  const coworker = isCoworkerAuthContext(auth) ? auth : null;
  tryUseLogger()?.set({
    legacyTaskScheduleShim: {
      method: c.req.method,
      path,
      mappedTarget,
      coworkerId: coworker?.coworkerId ?? null,
      vendorId: coworker?.vendorId ?? null,
      organizationId:
        coworker?.context?.organizationId ??
        c.var.workspaceContext?.organizationId ??
        null,
      workspaceId: c.var.workspaceContext?.workspaceId ?? null,
    },
  });
}

export function throwUnmappable(message: string, replacement: string): never {
  throw unprocessableEntity(message, {
    extensions: { replacement },
  });
}

/** Replaces `data` in the JSON answer the route below gave. */
export async function rewriteData(
  c: LegacyContext,
  edit: (data: unknown) => unknown,
): Promise<void> {
  if (c.res.status !== 200) {
    return;
  }
  const body = (await c.res.clone().json()) as { data?: unknown };
  c.res = new Response(
    JSON.stringify({ ...body, data: edit(body.data) }),
    c.res,
  );
}
