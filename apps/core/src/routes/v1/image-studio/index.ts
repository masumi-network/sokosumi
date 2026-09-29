import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetImageStudioCatalog from "./catalog-get.js";

/**
 * Studio-wide reads that are not about one project.
 *
 * No workspace context: the catalog is the provider's published capability and
 * price list and is identical for every project and every organization. Anything
 * that touches a project's own images stays under `/v1/projects/{id}/image-studio`,
 * where the per-project access check lives.
 */
const app = new OpenAPIHonoWithAuth();

mountGetImageStudioCatalog(app);

export default app;
