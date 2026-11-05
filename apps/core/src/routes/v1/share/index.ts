import { OpenAPIHono } from "@hono/zod-openapi";

import mountGetSharedResourceByToken from "./[token]/get.js";
import mountDriveShareDownload from "./drive/[token]/download.js";
import mountGetDriveShare from "./drive/[token]/get.js";
import mountUnlockDriveShare from "./drive/[token]/unlock.js";

const app = new OpenAPIHono();

// Before "/{token}", which would otherwise take "/drive".
const drive = new OpenAPIHono();
mountGetDriveShare(drive);
mountUnlockDriveShare(drive);
mountDriveShareDownload(drive);
app.route("/drive", drive);

mountGetSharedResourceByToken(app);

export default app;
