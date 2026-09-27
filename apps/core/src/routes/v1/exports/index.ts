import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountReleaseExportLease from "./leases/delete.js";
import mountAcquireExportLease from "./leases/post.js";

const app = new OpenAPIHonoWithAuth();
mountAcquireExportLease(app);
mountReleaseExportLease(app);
export default app;
