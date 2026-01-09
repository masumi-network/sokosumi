import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetPkce from "./pkce/post.js";

const app = new OpenAPIHonoWithAuth({
  includeOrganizationHeader: false,
});

mountGetPkce(app);

export default app;
