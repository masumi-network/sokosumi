import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { forgetDriveRooms } from "@/lib/drive-blob";
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

// Storage is a fake; the access gates and room rules below are the real ones,
// reading this Prisma fake.
const state = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; contentType: string }>(),
  /** Extra bytes a read returns beyond what HEAD reported. */
  grownBy: new Map<string, number>(),
  member: true,
  rooms: [] as {
    folderPath: string;
    storage: string;
    createdByUserId: string;
    colleagues: { userId: string }[];
  }[],
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/drive-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-blob")>()),
  driveExists: vi.fn(async (pathname: string) => state.files.has(pathname)),
  driveHasAny: vi.fn(async () => false),
  driveHead: vi.fn(async (pathname: string) => {
    const file = state.files.get(pathname);
    return file
      ? { size: file.bytes.byteLength, contentType: file.contentType }
      : null;
  }),
  driveRead: vi.fn(async (pathname: string) => {
    const file = state.files.get(pathname);
    if (!file) return null;
    const extra = new Uint8Array(state.grownBy.get(pathname) ?? 0);
    return { stream: new Response(Buffer.concat([file.bytes, extra])).body };
  }),
  drivePut: state.put,
  driveDel: state.del,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    dataRoom: { findMany: vi.fn(async () => state.rooms) },
    member: {
      findUnique: vi.fn(async () =>
        state.member
          ? { role: "member", organization: { id: "org_1", name: "Org" } }
          : null,
      ),
    },
  },
}));

vi.mock("@/helpers/drive-tasks-workspace", () => ({
  resolveDriveTasksWorkspace: vi.fn(async () => ({ workspaceId: "ws_1" })),
}));

const catalog = vi.hoisted(() => ({
  reserveDriveUploadResource: vi.fn(),
  activateDriveUploadResource: vi.fn(),
  tombstoneDriveUploadResource: vi.fn(),
}));
vi.mock("@/services/file-catalog.service", () => catalog);

vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: vi.fn(),
}));

const MEMBER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_1",
  role: "user",
  authenticationMethod: "session",
};

const DRIVE = "drive/organizations/org_1";
const FOLDER = `${DRIVE}/Pack`;

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", MEMBER);
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

async function addPdf(pathname: string, widths = [100]) {
  state.files.set(pathname, {
    bytes: await pdfWithPages(widths),
    contentType: "application/pdf",
  });
}

function combine(pathnames: string[], filename = "Pack") {
  return createApp().request("/combine-pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pathnames, filename }),
  });
}

function expectNothingSaved() {
  expect(state.put).not.toHaveBeenCalled();
  expect(catalog.reserveDriveUploadResource).not.toHaveBeenCalled();
}

beforeEach(() => {
  forgetDriveRooms();
  state.files.clear();
  state.grownBy.clear();
  state.member = true;
  state.rooms = [];
  state.put.mockReset().mockResolvedValue({});
  state.del.mockReset().mockResolvedValue(undefined);
  catalog.reserveDriveUploadResource.mockReset().mockResolvedValue({});
  catalog.activateDriveUploadResource
    .mockReset()
    .mockResolvedValue({ resourceId: "res_1" });
  catalog.tombstoneDriveUploadResource.mockReset().mockResolvedValue(undefined);
});

describe("POST /drive/files/combine-pdf", () => {
  it("saves the pages in the chosen order beside the first file and keeps the originals", async () => {
    await addPdf(`${FOLDER}/a.pdf`, [100]);
    await addPdf(`${FOLDER}/b.pdf`, [200, 300]);

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
    const [pathname, bytes, options] = state.put.mock.calls[0];
    expect(pathname).toBe(`${FOLDER}/Pack.pdf`);
    expect(options).toMatchObject({ allowOverwrite: false });
    const saved = await PDFDocument.load(bytes);
    expect(saved.getPages().map((page) => page.getWidth())).toEqual([
      200, 300, 100,
    ]);
    expect(state.files.has(`${FOLDER}/a.pdf`)).toBe(true);
    expect(state.files.has(`${FOLDER}/b.pdf`)).toBe(true);
    expect(state.del).not.toHaveBeenCalled();
  });

  it("saves nothing and names the file when one source cannot be read", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    state.files.set(`${FOLDER}/broken.pdf`, {
      bytes: new TextEncoder().encode("not a pdf"),
      contentType: "application/pdf",
    });

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/broken.pdf`]);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      kind: "unreadable_pdf",
      fileName: "broken.pdf",
    });
    expectNothingSaved();
  });

  it("refuses files over the total size cap before reading them", async () => {
    const big = new Uint8Array(30 * 1024 * 1024);
    for (const name of ["a.pdf", "b.pdf"])
      state.files.set(`${FOLDER}/${name}`, {
        bytes: big,
        contentType: "application/pdf",
      });

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ kind: "too_large" });
    expectNothingSaved();
  });

  it("stops reading when a file grew past the cap after its size was checked", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    state.grownBy.set(`${FOLDER}/b.pdf`, 51 * 1024 * 1024);

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(413);
    expectNothingSaved();
  });

  it("refuses a name that is already taken", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);

    const response = await combine(
      [`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`],
      "a.pdf",
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "name_taken",
      fileName: "a.pdf",
    });
    expectNothingSaved();
  });

  it("leaves the catalog alone when another save took the name first", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    // The other save lands between the name check and this put.
    state.put.mockImplementation(async (pathname: string) => {
      state.files.set(pathname, { bytes: new Uint8Array(1), contentType: "" });
      throw new Error("This blob already exists");
    });

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(409);
    expect(catalog.reserveDriveUploadResource).not.toHaveBeenCalled();
    expect(state.del).not.toHaveBeenCalled();
  });

  it("removes its own bytes and entry when the catalog step fails, so a retry works", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    catalog.activateDriveUploadResource.mockResolvedValue(null);

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(404);
    expect(state.del).toHaveBeenCalledWith([`${FOLDER}/Pack.pdf`]);
    expect(catalog.tombstoneDriveUploadResource).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      scope: "organization",
      ownerId: "org_1",
      pathname: `${FOLDER}/Pack.pdf`,
    });
  });

  it("refuses to take a data room's pages out of the room", async () => {
    state.rooms = [
      {
        folderPath: "Room",
        storage: "PRIVATE",
        createdByUserId: "user_123",
        colleagues: [],
      },
    ];
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${DRIVE}/Room/secret.pdf`);

    const response = await combine([
      `${FOLDER}/a.pdf`,
      `${DRIVE}/Room/secret.pdf`,
    ]);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      kind: "mixed_data_room",
      fileName: "secret.pdf",
    });
    expectNothingSaved();
  });

  it("combines files that are all inside the same room", async () => {
    state.rooms = [
      {
        folderPath: "Room",
        storage: "PRIVATE",
        createdByUserId: "user_123",
        colleagues: [],
      },
    ];
    await addPdf(`${DRIVE}/Room/a.pdf`);
    await addPdf(`${DRIVE}/Room/b.pdf`);

    const response = await combine([
      `${DRIVE}/Room/a.pdf`,
      `${DRIVE}/Room/b.pdf`,
    ]);

    expect(response.status).toBe(201);
    expect(state.put.mock.calls[0][0]).toBe(`${DRIVE}/Room/Pack.pdf`);
  });

  it("hides a room source from someone who is not in the room", async () => {
    state.rooms = [
      {
        folderPath: "Room",
        storage: "PRIVATE",
        createdByUserId: "someone_else",
        colleagues: [],
      },
    ];
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${DRIVE}/Room/secret.pdf`);

    const response = await combine([
      `${FOLDER}/a.pdf`,
      `${DRIVE}/Room/secret.pdf`,
    ]);

    expect(response.status).toBe(404);
    expectNothingSaved();
  });

  it("refuses someone who is not a member of the organization", async () => {
    state.member = false;
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(403);
    expectNothingSaved();
  });
});
