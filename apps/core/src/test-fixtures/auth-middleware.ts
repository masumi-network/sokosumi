/**
 * Pass-through auth middleware for route tests that still inject
 * `authContext` with a later `app.use`. OpenAPIHonoWithAuth applies
 * authMiddleware in its constructor, so tests must mock it.
 */
export async function stubAuthMiddleware(
  _c: unknown,
  next: () => Promise<unknown>,
) {
  return await next();
}
