import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetImageStudioCatalog from "./catalog-get.js";
import mountGetImageStudioState from "./state-get.js";

/**
 * Studio-wide reads that are not about one project.
 *
 * The catalog needs no workspace context: it is the provider's published
 * capability and price list and is identical for every project and every
 * organization. The workspace state reads every project in the caller's
 * workspace and re-checks membership itself. Anything that writes to a
 * project's images stays under `/v1/projects/{id}/image-studio`, where the
 * per-project access check lives.
 */
const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

mountGetImageStudioCatalog(app);
mountGetImageStudioState(app);

export default app;
