import { OpenAPIHono } from "@hono/zod-openapi";

import mountGetSharedResourceByToken from "./[token]/get.js";
import mountDriveShareDownload from "./drive/[token]/download.js";
import mountGetDriveShare from "./drive/[token]/get.js";
import mountUnlockDriveShare from "./drive/[token]/unlock.js";
import mountDataRoomCode from "./rooms/[token]/code.js";
import mountDataRoomFiles from "./rooms/[token]/files.js";
import mountGetDataRoom from "./rooms/[token]/get.js";
import mountDataRoomLogo from "./rooms/[token]/logo.js";
import mountDataRoomQuestions from "./rooms/[token]/questions.js";
import mountDataRoomSession from "./rooms/[token]/session.js";

const app = new OpenAPIHono();

// Before "/{token}", which would otherwise take "/drive".
const drive = new OpenAPIHono();
mountGetDriveShare(drive);
mountUnlockDriveShare(drive);
mountDriveShareDownload(drive);
app.route("/drive", drive);

// Data rooms: signed in by an emailed code, never by an account.
const rooms = new OpenAPIHono();
mountGetDataRoom(rooms);
mountDataRoomCode(rooms);
mountDataRoomSession(rooms);
mountDataRoomFiles(rooms);
mountDataRoomLogo(rooms);
mountDataRoomQuestions(rooms);
app.route("/rooms", rooms);

mountGetSharedResourceByToken(app);

export default app;
