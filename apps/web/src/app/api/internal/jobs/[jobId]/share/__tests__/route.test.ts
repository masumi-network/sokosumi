import { NextRequest } from "next/server";
import superJson from "superjson";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getJobByIdMock = vi.fn();
const upsertPublicShareMock = vi.fn();
const setShareAllowSearchIndexingByIdMock = vi.fn();
const deleteShareByJobIdMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  jobRepository: {
    getJobById: (...args: unknown[]) => getJobByIdMock(...args),
  },
  jobShareRepository: {
    upsertPublicShare: (...args: unknown[]) => upsertPublicShareMock(...args),
    setShareAllowSearchIndexingById: (...args: unknown[]) =>
      setShareAllowSearchIndexingByIdMock(...args),
    deleteShareByJobId: (...args: unknown[]) => deleteShareByJobIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

import { DELETE, PATCH, POST } from "../route";

function createRequest(
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
) {
  return new NextRequest("http://localhost:3000/api/internal/jobs/job-1/share", {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("internal job share route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => await callback({}),
    );
  });

  it("returns 401 when creating a share without a session", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await POST(
      createRequest("POST"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(401);
    expect(upsertPublicShareMock).not.toHaveBeenCalled();
  });

  it("creates a public share for an owned job", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
    });
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
    });
    upsertPublicShareMock.mockResolvedValue({
      id: "share-1",
      token: "public-token",
      allowSearchIndexing: true,
    });

    const response = await POST(
      createRequest("POST"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    expect(upsertPublicShareMock).toHaveBeenCalledWith("job-1", true, {});

    const body = await response.json();
    expect(superJson.parse(body.data)).toMatchObject({
      id: "share-1",
      token: "public-token",
      allowSearchIndexing: true,
    });
  });

  it("updates search indexing for an existing share", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
    });
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      share: { id: "share-1" },
    });
    setShareAllowSearchIndexingByIdMock.mockResolvedValue({
      id: "share-1",
      token: "public-token",
      allowSearchIndexing: false,
    });

    const response = await PATCH(
      createRequest("PATCH", { allowSearchIndexing: false }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    expect(setShareAllowSearchIndexingByIdMock).toHaveBeenCalledWith(
      "share-1",
      false,
      {},
    );
  });

  it("deletes the share without refreshing the route transport", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
    });
    getJobByIdMock.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
    });

    const response = await DELETE(
      createRequest("DELETE"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    expect(deleteShareByJobIdMock).toHaveBeenCalledWith("job-1", {});
  });
});
