import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetMeCredits from "./credits/get.js";
import mountGetMe from "./get.js";
import mountGoogleDriveCallbackGet from "./google-drive/callback.get.js";
import mountGoogleDriveConnectPost from "./google-drive/connect.post.js";
import mountGoogleDriveDisconnectDelete from "./google-drive/disconnect.delete.js";
import mountGoogleDriveFileDelete from "./google-drive/files/[fileId]/delete.js";
import mountGoogleDriveFileGet from "./google-drive/files/[fileId]/get.js";
import mountGoogleDriveFileContentGet from "./google-drive/files/[fileId]/content.get.js";
import mountGoogleDriveFilePatch from "./google-drive/files/[fileId]/patch.js";
import mountGoogleDriveFilesCreate from "./google-drive/files/create.post.js";
import mountGoogleDriveFilesList from "./google-drive/files/list.get.js";
import mountGoogleDriveFoldersPost from "./google-drive/folders.post.js";
import mountGoogleDriveStatusGet from "./google-drive/status.get.js";
import mountPostNoticeAcknowledge from "./notices/[id]/acknowledge/post.js";
import mountGetPendingNotices from "./notices/pending/get.js";
import mountGetMeOnboarding from "./onboarding/get.js";
import mountPostMeOnboarding from "./onboarding/post.js";
import mountGetMeOrganizationCredits from "./organizations/[id]/credits/get.js";
import mountGetMeOrganizations from "./organizations/get.js";
import mountGetMePreferences from "./preferences/get.js";
import mountPatchMePreferences from "./preferences/patch.js";
import mountGetMeUploads from "./uploads/get.js";
import mountPostMeUploads from "./uploads/post.js";

const app = new OpenAPIHonoWithAuth();

mountGetMe(app);
mountGetMeOrganizations(app);
mountGetMeOrganizationCredits(app);
mountGetMeCredits(app);
mountGetMePreferences(app);
mountPatchMePreferences(app);
mountGetMeOnboarding(app);
mountPostMeOnboarding(app);
mountGetPendingNotices(app);
mountPostNoticeAcknowledge(app);
mountGetMeUploads(app);
mountPostMeUploads(app);

// Google Drive
mountGoogleDriveStatusGet(app);
mountGoogleDriveConnectPost(app);
mountGoogleDriveCallbackGet(app);
mountGoogleDriveDisconnectDelete(app);
mountGoogleDriveFilesList(app);
mountGoogleDriveFilesCreate(app);
mountGoogleDriveFileGet(app);
mountGoogleDriveFileContentGet(app);
mountGoogleDriveFilePatch(app);
mountGoogleDriveFileDelete(app);
mountGoogleDriveFoldersPost(app);

export default app;
