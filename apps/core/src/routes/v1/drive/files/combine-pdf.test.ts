import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountCombinePdf from "./combine-pdf.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const blob = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; contentType: string }>(),
  put: vi.fn(),
}));

vi.mock("@/lib/drive-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-blob")>()),
  driveExists: vi.fn(async (pathname: string) => blob.files.has(pathname)),
  driveHasAny: vi.fn(async () => false),
  driveHead: vi.fn(async (pathname: string) => {
    const file = blob.files.get(pathname);
    return file
      ? { size: file.bytes.byteLength, contentType: file.contentType }
      : null;
  }),
  driveRead: vi.fn(async (pathname: string) => {
    const file = blob.files.get(pathname);
    return file ? { stream: new Response(file.bytes.slice()).body } : null;
  }),
  drivePut: blob.put,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { dataRoom: { findMany: vi.fn(async () => []) } },
}));

vi.mock("@/helpers/drive-file-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/drive-file-access")>()),
  requireDriveFileAccess: vi.fn(async () => ({ hiddenRoomFolders: [] })),
  requireUserDriveFileUploadAccess: vi.fn(async () => undefined),
  requireOrganizationDriveFileUploadAccess: vi.fn(async () => undefined),
}));

vi.mock("@/helpers/drive-tasks-workspace", () => ({
  resolveDriveTasksWorkspace: vi.fn(async () => ({ workspaceId: "ws_1" })),
}));

vi.mock("@/services/file-catalog.service", () => ({
  reserveDriveUploadResource: vi.fn(async () => ({})),
  activateDriveUploadResource: vi.fn(async () => ({ resourceId: "res_1" })),
}));

vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: vi.fn(),
}));

const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const FOLDER = "drive/users/user_123/Pack";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", USER);
    c.set("requestId", "req_123");
    await next();
  });
  mountCombinePdf(app);
  return app;
}

async function pdfWithPages(widths: number[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 800]);
  return pdf.save();
}

function combine(pathnames: string[], filename = "Pack") {
  return createApp().request("/combine-pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pathnames, filename }),
  });
}

beforeEach(() => {
  blob.files.clear();
  blob.put.mockReset();
});

describe("POST /drive/files/combine-pdf", () => {
  it("saves the pages in the chosen order beside the first file and keeps the originals", async () => {
    blob.files.set(`${FOLDER}/a.pdf`, {
      bytes: await pdfWithPages([100]),
      contentType: "application/pdf",
    });
    blob.files.set(`${FOLDER}/b.pdf`, {
      bytes: await pdfWithPages([200, 300]),
      contentType: "application/pdf",
    });

    const response = await combine([`${FOLDER}/b.pdf`, `${FOLDER}/a.pdf`]);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        resourceId: "res_1",
        name: "Pack.pdf",
        pathname: `${FOLDER}/Pack.pdf`,
        pageCount: 3,
      },
    });
    expect(blob.put).toHaveBeenCalledTimes(1);
    const [pathname, bytes] = blob.put.mock.calls[0];
    expect(pathname).toBe(`${FOLDER}/Pack.pdf`);
    const saved = await PDFDocument.load(bytes);
    expect(saved.getPages().map((page) => page.getWidth())).toEqual([
      200, 300, 100,
    ]);
    expect(blob.files.has(`${FOLDER}/a.pdf`)).toBe(true);
    expect(blob.files.has(`${FOLDER}/b.pdf`)).toBe(true);
  });

  it("saves nothing and names the file when one source cannot be read", async () => {
    blob.files.set(`${FOLDER}/a.pdf`, {
      bytes: await pdfWithPages([100]),
      contentType: "application/pdf",
    });
    blob.files.set(`${FOLDER}/broken.pdf`, {
      bytes: new TextEncoder().encode("not a pdf"),
      contentType: "application/pdf",
    });

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/broken.pdf`]);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      kind: "unreadable_pdf",
      message: expect.stringContaining('"broken.pdf"'),
    });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("refuses files over the total size cap before reading them", async () => {
    const big = new Uint8Array(30 * 1024 * 1024);
    blob.files.set(`${FOLDER}/a.pdf`, {
      bytes: big,
      contentType: "application/pdf",
    });
    blob.files.set(`${FOLDER}/b.pdf`, {
      bytes: big,
      contentType: "application/pdf",
    });

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(413);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("refuses a name that is already taken", async () => {
    blob.files.set(`${FOLDER}/a.pdf`, {
      bytes: await pdfWithPages([100]),
      contentType: "application/pdf",
    });
    blob.files.set(`${FOLDER}/b.pdf`, {
      bytes: await pdfWithPages([100]),
      contentType: "application/pdf",
    });

    const response = await combine(
      [`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`],
      "a.pdf",
    );

    expect(response.status).toBe(409);
    expect(blob.put).not.toHaveBeenCalled();
  });
});
