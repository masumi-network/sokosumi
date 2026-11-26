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

const workspaces = vi.hoisted(() => ({
  resolveDriveTasksWorkspace: vi.fn(),
}));
vi.mock("@/helpers/drive-tasks-workspace", () => workspaces);

// A catalog with the one rule that matters here: one row per pathname.
const catalog = vi.hoisted(() => {
  const rows = new Map<string, { id: string; live: boolean }>();
  let next = 0;
  return {
    rows,
    reset() {
      rows.clear();
      next = 0;
    },
    claimDriveUploadResource: vi.fn(
      async (input: { key: { pathname: string } }) => {
        if (rows.has(input.key.pathname)) return null;
        const id = `res_${++next}`;
        rows.set(input.key.pathname, { id, live: false });
        return { resourceId: id };
      },
    ),
    activateDriveUploadResource: vi.fn(
      async (input: { key: { pathname: string } }) => {
        const row = rows.get(input.key.pathname);
        if (!row) return null;
        row.live = true;
        return { resourceId: row.id };
      },
    ),
    releaseDriveUploadClaim: vi.fn(async (id: string) => {
      for (const [pathname, row] of rows)
        if (row.id === id && !row.live) rows.delete(pathname);
    }),
  };
});
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
  expect(catalog.claimDriveUploadResource).not.toHaveBeenCalled();
}

beforeEach(() => {
  forgetDriveRooms();
  state.files.clear();
  state.grownBy.clear();
  state.member = true;
  state.rooms = [];
  state.put
    .mockReset()
    .mockImplementation(async (pathname: string, bytes: Uint8Array) => {
      if (state.files.has(pathname))
        throw new Error("This blob already exists");
      state.files.set(pathname, { bytes, contentType: "application/pdf" });
      return {};
    });
  state.del.mockReset().mockImplementation(async (paths: string[]) => {
    for (const path of paths) state.files.delete(path);
  });
  catalog.reset();
  vi.clearAllMocks();
  workspaces.resolveDriveTasksWorkspace.mockResolvedValue({
    workspaceId: "ws_1",
  });
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

  it("saves nothing when the workspace cannot be resolved", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    workspaces.resolveDriveTasksWorkspace.mockRejectedValue(
      new Error("workspace lookup failed"),
    );

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(500);
    expectNothingSaved();
    expect(state.files.has(`${FOLDER}/Pack.pdf`)).toBe(false);
  });

  it("leaves another upload's pending entry alone and writes no bytes", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    catalog.rows.set(`${FOLDER}/Pack.pdf`, { id: "theirs", live: false });

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(409);
    expect(state.put).not.toHaveBeenCalled();
    expect(catalog.rows.get(`${FOLDER}/Pack.pdf`)).toEqual({
      id: "theirs",
      live: false,
    });
    expect(catalog.releaseDriveUploadClaim).not.toHaveBeenCalled();
  });

  it("releases only its own claim when another save's bytes landed first", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    state.put.mockImplementationOnce(async (pathname: string) => {
      state.files.set(pathname, { bytes: new Uint8Array(1), contentType: "" });
      throw new Error("This blob already exists");
    });

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(409);
    expect(state.del).not.toHaveBeenCalled();
    expect(catalog.rows.has(`${FOLDER}/Pack.pdf`)).toBe(false);
    // The other save's bytes stay.
    expect(state.files.has(`${FOLDER}/Pack.pdf`)).toBe(true);
  });

  it("undoes a save whose activation fails, and a retry then succeeds", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    catalog.activateDriveUploadResource.mockResolvedValueOnce(null);

    const failed = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(failed.status).toBe(404);
    expect(state.files.has(`${FOLDER}/Pack.pdf`)).toBe(false);
    expect(catalog.rows.has(`${FOLDER}/Pack.pdf`)).toBe(false);

    const retried = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(retried.status).toBe(201);
    expect(state.files.has(`${FOLDER}/Pack.pdf`)).toBe(true);
    expect(catalog.rows.get(`${FOLDER}/Pack.pdf`)?.live).toBe(true);
  });

  it("keeps the name claimed when its own bytes cannot be removed", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    catalog.activateDriveUploadResource.mockResolvedValueOnce(null);
    state.del.mockRejectedValueOnce(new Error("storage unavailable"));

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(404);
    expect(catalog.releaseDriveUploadClaim).not.toHaveBeenCalled();
    expect(catalog.rows.has(`${FOLDER}/Pack.pdf`)).toBe(true);
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
