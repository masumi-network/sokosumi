import { OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import { type AuthVariables, authMiddleware } from "@/middleware/auth";
import { coworkerContextMiddleware } from "@/middleware/coworker-context";
import { organizationHeaderMiddleware } from "@/middleware/organization";
import { organizationProductSeatMiddleware } from "@/middleware/organization-product-seat";
import {
  type WorkspaceVariables,
  workspaceMiddleware,
} from "@/middleware/workspace";

/**
 * Global hook for OpenAPI validation errors
 * Converts ZodErrors to HTTPExceptions that our error handler can process
 */
export function defaultValidationHook(result: {
  success: boolean;
  error?: z.ZodError;
}) {
  if (!result.success && result.error) {
    throw unprocessableEntity(formatZodErrorMessage(result.error));
  }
}

/**
 * Options for OpenAPIHonoWithAuth constructor
 */
export interface OpenAPIHonoWithAuthOptions {
  /**
   * Whether to include the workspace context middleware.
   * Defaults to false. Set to true for routers that need workspace-scoped reads.
   */
  includeWorkspaceContext?: boolean;
  /**
   * Human org members need an assigned Seat to use this router.
   * Personal workspace and coworker actors skip the gate. A sokoBot
   * skips only when organizationId is absent; an org-scoped bot is
   * checked against the owner's userId and can 403.
   */
  requireOrganizationProductSeat?: boolean;
}

export type EnvVariables = {
  Variables: AuthVariables & WorkspaceVariables;
};

/**
 * Type-safe OpenAPIHono class with AuthContext in Variables
 * Use this for OpenAPI routes that require authentication
 *
 * Auth middleware is automatically applied - all routes are protected
 * Coworker context middleware runs after auth to attach optional workspace scope from headers.
 * Organization header middleware is also applied to set organizationId from X-Organization-Slug header
 * For mixed public/private routes, use standard OpenAPIHono class instead
 *
 * @example
 * const app = new OpenAPIHonoWithAuth();
 * // authMiddleware and organizationHeaderMiddleware are already applied
 */
export class OpenAPIHonoWithAuth<
  ExtraVariables extends object = {},
> extends OpenAPIHono<{
  Variables: EnvVariables["Variables"] & ExtraVariables;
}> {
  constructor(options: OpenAPIHonoWithAuthOptions = {}) {
    const {
      includeWorkspaceContext = false,
      requireOrganizationProductSeat = false,
    } = options;

    super({
      defaultHook: defaultValidationHook,
    });

    this.use(authMiddleware);
    this.use(coworkerContextMiddleware);
    this.use(organizationHeaderMiddleware);
    this.use(workspaceMiddleware(includeWorkspaceContext));
    if (requireOrganizationProductSeat) {
      this.use(organizationProductSeatMiddleware);
    }
  }
}

const ORGANIZATION_SLUG_PARAMETER = {
  $ref: "#/components/parameters/OrganizationSlug",
} as const;

const COWORKER_CONTEXT_HEADER_PARAMETERS = [
  ORGANIZATION_SLUG_PARAMETER,
  { $ref: "#/components/parameters/ContextUserId" },
  { $ref: "#/components/parameters/ContextOrganizationId" },
] as const;

function withHeaderParameters<T extends RouteConfig>(
  route: T,
  parameters: ReadonlyArray<{ readonly $ref: string }>,
): T {
  return {
    ...route,
    parameters: [...(route.parameters ?? []), ...parameters],
  } as T;
}

/**
 * Optional `X-Organization-Slug` only. Use when the route does not accept
 * coworker `X-Context-*` authentication.
 */
export function withOrganizationSlugHeaderParameter<T extends RouteConfig>(
  route: T,
): T {
  return withHeaderParameters(route, [ORGANIZATION_SLUG_PARAMETER]);
}

/**
 * Organization slug plus coworker workspace context headers.
 * Use only when the handler accepts coworker auth with
 * `X-Context-User-Id` / optional `X-Context-Organization-Id`.
 */
export function withCoworkerContextHeaderParameters<T extends RouteConfig>(
  route: T,
): T {
  return withHeaderParameters(route, COWORKER_CONTEXT_HEADER_PARAMETERS);
}

/**
 * Default OpenAPI header params for authenticated routes: organization slug
 * only. Prefer {@link withCoworkerContextHeaderParameters} or
 * another explicit route parameter set when the route accepts contextual auth.
 */
export function withGlobalHeaderParameters<T extends RouteConfig>(route: T): T {
  return withOrganizationSlugHeaderParameter(route);
}
