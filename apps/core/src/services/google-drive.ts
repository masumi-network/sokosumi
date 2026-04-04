/**
 * Google Drive REST API v3 service.
 *
 * Uses raw `fetch` -- no googleapis SDK dependency required.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
  iconLink?: string;
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

interface TokenRefreshResult {
  accessToken: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const DEFAULT_FILE_FIELDS =
  "id,name,mimeType,createdTime,modifiedTime,size,parents,webViewLink,iconLink";

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function assertOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Google Drive API error (${context}): ${res.status} ${res.statusText} - ${body}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenRefreshResult> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  await assertOk(res, "refreshAccessToken");

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ---------------------------------------------------------------------------
// Drive operations
// ---------------------------------------------------------------------------

export async function listFiles(
  accessToken: string,
  options?: {
    folderId?: string;
    query?: string;
    pageSize?: number;
    pageToken?: string;
  },
): Promise<DriveFileList> {
  const params = new URLSearchParams({
    fields: `nextPageToken,files(${DEFAULT_FILE_FIELDS})`,
    pageSize: String(options?.pageSize ?? 20),
  });

  const queryParts: string[] = [];
  if (options?.folderId) {
    queryParts.push(`'${options.folderId}' in parents`);
  }
  if (options?.query) {
    queryParts.push(options.query);
  }
  // Exclude trashed files by default
  queryParts.push("trashed = false");

  params.set("q", queryParts.join(" and "));

  if (options?.pageToken) {
    params.set("pageToken", options.pageToken);
  }

  const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });

  await assertOk(res, "listFiles");
  return (await res.json()) as DriveFileList;
}

export async function getFile(
  accessToken: string,
  fileId: string,
): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: DEFAULT_FILE_FIELDS });
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers: authHeaders(accessToken) },
  );

  await assertOk(res, "getFile");
  return (await res.json()) as DriveFile;
}

/**
 * Download file content.
 *
 * For Google Workspace documents (Docs, Sheets, Slides) the export endpoint is
 * used.  For regular files `alt=media` is used.
 */
export async function getFileContent(
  accessToken: string,
  fileId: string,
  mimeType?: string,
): Promise<string | Buffer> {
  const googleDocsMimeTypes = [
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.google-apps.presentation",
  ];

  // If a Google Workspace document, use export endpoint
  const fileMeta = await getFile(accessToken, fileId);

  if (googleDocsMimeTypes.includes(fileMeta.mimeType)) {
    const exportMimeType = mimeType ?? "text/plain";
    const params = new URLSearchParams({ mimeType: exportMimeType });
    const res = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?${params.toString()}`,
      { headers: authHeaders(accessToken) },
    );
    await assertOk(res, "getFileContent/export");
    return await res.text();
  }

  // Regular file -- download raw bytes
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: authHeaders(accessToken) },
  );
  await assertOk(res, "getFileContent/download");

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.startsWith("text/") || contentType.includes("json")) {
    return await res.text();
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function createFile(
  accessToken: string,
  name: string,
  content: string,
  mimeType: string,
  folderId?: string,
): Promise<DriveFile> {
  const metadata: Record<string, unknown> = { name, mimeType };
  if (folderId) {
    metadata.parents = [folderId];
  }

  const boundary = "sokosumi_boundary";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: DEFAULT_FILE_FIELDS,
  });

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files?${params.toString()}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  await assertOk(res, "createFile");
  return (await res.json()) as DriveFile;
}

export async function updateFileContent(
  accessToken: string,
  fileId: string,
  content: string,
  mimeType: string,
): Promise<DriveFile> {
  const boundary = "sokosumi_boundary";
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({}),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: DEFAULT_FILE_FIELDS,
  });

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  await assertOk(res, "updateFileContent");
  return (await res.json()) as DriveFile;
}

export async function deleteFile(
  accessToken: string,
  fileId: string,
): Promise<void> {
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      headers: authHeaders(accessToken),
    },
  );

  await assertOk(res, "deleteFile");
}

export async function createFolder(
  accessToken: string,
  name: string,
  parentFolderId?: string,
): Promise<DriveFile> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const params = new URLSearchParams({ fields: DEFAULT_FILE_FIELDS });

  const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });

  await assertOk(res, "createFolder");
  return (await res.json()) as DriveFile;
}
