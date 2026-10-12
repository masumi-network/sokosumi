import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { GET } from "./route";

const proxy = vi.hoisted(() =>
  vi.fn().mockResolvedValue(new Response("bytes")),
);
vi.mock("@/lib/clients/utils/proxy-core-file-content", () => ({
  proxyCoreFileContent: proxy,
}));
it("encodes source ids and forwards only the supported download option", async () => {
  const request = new NextRequest(
    "http://localhost/api/jobs/job/files/file/content?download=true&url=https://untrusted.test",
  );
  await GET(request, {
    params: Promise.resolve({ jobId: "job/other", fileId: "file?url=foreign" }),
  });
  expect(proxy).toHaveBeenCalledWith(
    request,
    "/jobs/job%2Fother/files/file%3Furl%3Dforeign/content?download=true",
  );
});
