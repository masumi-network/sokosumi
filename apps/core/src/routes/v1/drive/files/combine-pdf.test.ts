import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { forgetDriveRooms } from "@/lib/drive-blob";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountCombinePdf, { downloadName } from "./combine-pdf.js";

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
}));

// Combining only reads: a Drive write or a labelling nudge is a bug.
const writes = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
  nudge: vi.fn(),
}));
vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: writes.nudge,
}));

vi.mock("@/lib/drive-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-blob")>()),
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
  drivePut: writes.put,
  driveDel: writes.del,
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

const MEMBER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_1",
  role: "user",
  authenticationMethod: "session",
};

const DRIVE = "drive/organizations/org_1";
const ROOM = (createdByUserId: string) => ({
  folderPath: "Room",
  storage: "PRIVATE",
  createdByUserId,
  colleagues: [],
});
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

async function pageWidths(response: Response): Promise<number[]> {
  const pdf = await PDFDocument.load(await response.arrayBuffer());
  return pdf.getPages().map((page) => page.getWidth());
}

beforeEach(() => {
  forgetDriveRooms();
  state.files.clear();
  state.grownBy.clear();
  state.member = true;
  state.rooms = [];
  vi.clearAllMocks();
});

afterEach(() => {
  for (const write of Object.values(writes))
    expect(write).not.toHaveBeenCalled();
});

describe("POST /drive/files/combine-pdf", () => {
  it("returns one PDF with the pages in the chosen order, as a download", async () => {
    await addPdf(`${FOLDER}/a.pdf`, [100]);
    await addPdf(`${FOLDER}/b.pdf`, [200, 300]);

    const response = await combine([`${FOLDER}/b.pdf`, `${FOLDER}/a.pdf`]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Pack\.pdf"/,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await pageWidths(response)).toEqual([200, 300, 100]);
    expect(state.files.has(`${FOLDER}/a.pdf`)).toBe(true);
    expect(state.files.has(`${FOLDER}/b.pdf`)).toBe(true);
  });

  it("keeps a name that already ends in .pdf", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);

    const response = await combine(
      [`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`],
      "a.PDF",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /filename="a\.PDF"/,
    );
  });

  it("names the file that passes the page limit", async () => {
    await addPdf(`${FOLDER}/a.pdf`, new Array(1_500).fill(100));
    await addPdf(`${FOLDER}/b.pdf`, new Array(600).fill(100));

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      kind: "too_complex",
      fileName: "b.pdf",
    });
  });

  it("names the file and returns nothing when one source cannot be read", async () => {
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
  });

  it("refuses a source that is not a PDF", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    state.files.set(`${FOLDER}/notes.txt`, {
      bytes: new TextEncoder().encode("hello"),
      contentType: "text/plain",
    });

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/notes.txt`]);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      kind: "unreadable_pdf",
      fileName: "notes.txt",
    });
  });

  it("names a source that is gone", async () => {
    await addPdf(`${FOLDER}/a.pdf`);

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/gone.pdf`]);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ fileName: "gone.pdf" });
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
  });

  it("stops reading when a file grew past the cap after its size was checked", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);
    state.grownBy.set(`${FOLDER}/b.pdf`, 51 * 1024 * 1024);

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(413);
  });

  it("refuses to mix a data room's pages with files outside it", async () => {
    state.rooms = [ROOM("user_123")];
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
  });

  it("combines files that are all inside the same room", async () => {
    state.rooms = [ROOM("user_123")];
    await addPdf(`${DRIVE}/Room/a.pdf`, [100]);
    await addPdf(`${DRIVE}/Room/b.pdf`, [200]);

    const response = await combine([
      `${DRIVE}/Room/a.pdf`,
      `${DRIVE}/Room/b.pdf`,
    ]);

    expect(response.status).toBe(200);
    expect(await pageWidths(response)).toEqual([100, 200]);
  });

  it("hides a room source from someone who is not in the room", async () => {
    state.rooms = [ROOM("someone_else")];
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${DRIVE}/Room/secret.pdf`);

    const response = await combine([
      `${FOLDER}/a.pdf`,
      `${DRIVE}/Room/secret.pdf`,
    ]);

    expect(response.status).toBe(404);
  });

  it("refuses someone who is not a member of the organization", async () => {
    state.member = false;
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf(`${FOLDER}/b.pdf`);

    const response = await combine([`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`]);

    expect(response.status).toBe(403);
  });

  it("refuses files from two Drives", async () => {
    await addPdf(`${FOLDER}/a.pdf`);
    await addPdf("drive/users/user_123/b.pdf");

    const response = await combine([
      `${FOLDER}/a.pdf`,
      "drive/users/user_123/b.pdf",
    ]);

    expect(response.status).toBe(422);
  });
});

describe("downloadName", () => {
  it("adds .pdf, and keeps the case of one already there", () => {
    expect(downloadName("Pack")).toBe("Pack.pdf");
    expect(downloadName("a.PDF")).toBe("a.PDF");
  });

  it("keeps .pdf on a name too long for either header form", () => {
    const ascii = downloadName("x".repeat(200));
    expect(ascii.endsWith(".pdf")).toBe(true);
    expect(ascii.length).toBeLessThanOrEqual(120);

    const wide = downloadName("報".repeat(200));
    expect(wide.endsWith(".pdf")).toBe(true);
    expect(encodeURIComponent(wide).length).toBeLessThanOrEqual(240);
  });

  it("survives a lone surrogate and a name that is only the extension", () => {
    expect(downloadName("a\uD800b")).toBe("a\uFFFDb.pdf");
    expect(downloadName(".pdf")).toBe("Combined.pdf");
  });
});

it("keeps .pdf in the download header for a long name", async () => {
  await addPdf(`${FOLDER}/a.pdf`);
  await addPdf(`${FOLDER}/b.pdf`);

  const response = await combine(
    [`${FOLDER}/a.pdf`, `${FOLDER}/b.pdf`],
    "(draft) ".repeat(25),
  );

  const header = response.headers.get("content-disposition") ?? "";
  expect(header).toMatch(/filename="[^"]*\.pdf"/);
  expect(header).toMatch(/filename\*=UTF-8''[^;]*\.pdf$/);
  expect(header.split("UTF-8''")[1]).not.toMatch(/[()']/);
});
