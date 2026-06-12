import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAdminInvoice from "./[id]/get.js";
import mountMarkAdminInvoicePaid from "./[id]/pay/post.js";
import mountListAdminInvoices from "./get.js";
import mountCreateAdminInvoice from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminInvoices(app);
mountCreateAdminInvoice(app);
// Static segments must mount before parameterized ones; /{id}/pay is more
// specific than /{id} so it goes first.
mountMarkAdminInvoicePaid(app);
mountGetAdminInvoice(app);

export default app;
