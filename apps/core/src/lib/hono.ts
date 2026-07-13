import { OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import { type AuthVariables, authMiddleware } from "@/middleware/auth";
import { coworkerContextMiddleware } from "@/middleware/coworker-context";
import { organizationHeaderMiddleware } from "@/middleware/organization";
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
    const { includeWorkspaceContext = false } = options;

    super({
      defaultHook: defaultValidationHook,
    });

    this.use(authMiddleware);
    this.use(coworkerContextMiddleware);
    this.use(organizationHeaderMiddleware);
    this.use(workspaceMiddleware(includeWorkspaceContext));
  }
}

/**
 * Helper to attach the global header parameter to routes
 * @param route - The route definition
 * @returns The route definition with the global header parameter
 */
export function withGlobalHeaderParameters<T extends RouteConfig>(route: T): T {
  return {
    ...route,
    parameters: [
      ...(route.parameters ?? []),
      { $ref: "#/components/parameters/OrganizationSlug" },
      { $ref: "#/components/parameters/ContextUserId" },
      { $ref: "#/components/parameters/ContextOrganizationId" },
      { $ref: "#/components/parameters/DelegationUserId" },
      { $ref: "#/components/parameters/DelegationOrganizationId" },
    ],
  } as T;
}
