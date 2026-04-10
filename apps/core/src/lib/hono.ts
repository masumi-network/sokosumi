import { OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import { type AuthEnv, authMiddleware } from "@/middleware/auth";
import { organizationHeaderMiddleware } from "@/middleware/organization";
import { workspaceContextMiddleware } from "@/middleware/workspace-context";

/**
 * Global hook for OpenAPI validation errors
 * Converts ZodErrors to HTTPExceptions that our error handler can process
 */
function defaultValidationHook(result: {
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
   * Whether to include the organization header middleware.
   * Defaults to true. Set to false to disable organization context handling.
   */
  includeOrganizationHeader?: boolean;
  /**
   * Whether to include the workspace context middleware.
   * Defaults to false. Set to true for routers that need workspace-scoped reads.
   */
  includeWorkspaceContext?: boolean;
}

/**
 * Type-safe OpenAPIHono class with AuthContext in Variables
 * Use this for OpenAPI routes that require authentication
 *
 * Auth middleware is automatically applied - all routes are protected
 * Organization header middleware is also applied to set organizationId from X-Organization-Slug header
 * For mixed public/private routes, use standard OpenAPIHono class instead
 *
 * @example
 * const app = new OpenAPIHonoWithAuth();
 * // authMiddleware and organizationHeaderMiddleware are already applied
 */
export class OpenAPIHonoWithAuth extends OpenAPIHono<AuthEnv> {
  constructor(options: OpenAPIHonoWithAuthOptions = {}) {
    const {
      includeOrganizationHeader = true,
      includeWorkspaceContext = false,
    } = options;

    super({
      defaultHook: defaultValidationHook,
    });
    this.use(async (c, next) => {
      c.set("workspaceContext", null);
      return await next();
    });
    this.use(authMiddleware);
    if (includeOrganizationHeader) {
      this.use(organizationHeaderMiddleware);
    }
    if (includeWorkspaceContext) {
      this.use(workspaceContextMiddleware);
    }
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
    ],
  } as T;
}
