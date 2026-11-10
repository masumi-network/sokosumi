import { randomUUID } from "node:crypto";

import { OpenAPIHono } from "@hono/zod-openapi";
import { convertCreditsToCents, productBrief } from "@sokosumi/utils";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({
  fetch: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  submit: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "campaign-public-fixture",
      IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "campaign-private-fixture",
      AI_GATEWAY_API_KEY: undefined,
    }),
    getBetterAuthPublicBaseUrl: () => null,
  };
});
vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: external.fetch,
}));
vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  get: external.get,
  put: external.put,
}));
vi.mock("@/lib/image-studio/fal-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-studio/fal-client")>()),
  submitToQueue: external.submit,
  downloadMedia: external.download,
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  publishStudioAssetToFiles: vi.fn(),
  writeStudioDriveFile: vi.fn(),
}));

import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import mountAssetContent from "@/routes/v1/projects/[id]/image-studio/asset-content-get";
import mountBatchAssets from "@/routes/v1/projects/[id]/image-studio/batch-assets-get";
import mountBrandKit from "@/routes/v1/projects/[id]/image-studio/brand-kit";
import mountWebsiteLogo from "@/routes/v1/projects/[id]/image-studio/brand-logo-website-post";
import mountJobs from "@/routes/v1/projects/[id]/image-studio/jobs-post";
import mountSaveProducts from "@/routes/v1/projects/[id]/image-studio/products/put";
import mountPatchProject from "@/routes/v1/projects/[id]/patch";
import {
  imageStudioAssetSchema,
  imageStudioJobSchema,
} from "@/schemas/project-image-studio.schema";
import {
  studioBrandKitSchema,
  studioWebsiteDraftSchema,
} from "@/schemas/studio-brand-kit.schema";
import { settleWithMedia } from "@/services/image-studio-jobs.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const shop = "https://fieldwork.example/";
const blobOrigin = "https://campaign.public.blob.vercel-storage.com";
const designMd = `${blobOrigin}/design-md/campaign-test.md`;
const approvedLine = "Brew at your own pace.";
const unusedLine = "An old promotion";
const userId = randomUUID();
const batchId = randomUUID();

let workspaceId: string;
let projectId: string;

function app(actorId = userId) {
  const server = new OpenAPIHono<EnvVariables>();
  server.use("*", async (c, next) => {
    c.set("requestId", "studio-campaign-fixture");
    c.set("authContext", {
      actor: "user",
      authenticationMethod: "session",
      userId: actorId,
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      userId: actorId,
      workspaceId,
      organizationId: null,
    });
    await next();
  });
  mountBrandKit(server);
  mountWebsiteLogo(server);
  mountPatchProject(server);
  mountSaveProducts(server);
  mountJobs(server);
  mountBatchAssets(server);
  mountAssetContent(server);
  return server;
}

function json(method: "POST" | "PUT" | "PATCH", body: unknown) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe.skipIf(!enabled)("Studio campaign from website to export", () => {
  beforeAll(async () => {
    workspaceId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Studio campaign fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: "Fieldwork Coffee",
        websiteUrl: shop,
        designMdUrl: designMd,
      },
    });
    projectId = project.id;
    const grant = await prisma.transaction.create({
      data: { userId, amount: convertCreditsToCents(100) },
    });
    await prisma.creditBucket.create({
      data: { userId, amount: grant.amount, sourceTransactionId: grant.id },
    });

    const blobs = new Map<
      string,
      { bytes: Uint8Array<ArrayBuffer>; contentType: string }
    >();
    external.put.mockImplementation(
      (
        pathname: string,
        bytes: Uint8Array,
        options: { contentType: string },
      ) => {
        blobs.set(pathname, {
          bytes: new Uint8Array(bytes),
          contentType: options.contentType,
        });
        return { pathname, url: `${blobOrigin}/${pathname}` };
      },
    );
    external.get.mockImplementation((pathname: string) => {
      const blob = blobs.get(pathname);
      return (
        blob && {
          blob: { contentType: blob.contentType, size: blob.bytes.byteLength },
          headers: new Headers(),
          statusCode: 200,
          stream: new Response(blob.bytes).body,
        }
      );
    });
    external.fetch.mockImplementation((input: string | URL) => {
      const url = new URL(input);
      if (url.href === shop) {
        return new Response(
          `<meta name="description" content="Tools for brewing coffee.">
           <script type="application/ld+json">{"@type":"OnlineStore","logo":"/wordmark.svg"}</script>
           <main><h1>${approvedLine}</h1><h2>${unusedLine}</h2></main>`,
          { headers: { "content-type": "text/html", "x-shopid": "123" } },
        );
      }
      if (url.href === new URL("products.json?limit=20", shop).href) {
        return Response.json({
          products: [
            {
              title: "Pour-over set",
              handle: "pour-over",
              variants: [{ price: "48" }],
            },
            {
              title: "Travel mug",
              handle: "travel-mug",
              variants: [{ price: "32" }],
            },
          ],
        });
      }
      if (url.href === new URL("wordmark.svg", shop).href) {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="12"><rect width="40" height="12" fill="#a33421"/></svg>',
          { headers: { "content-type": "image/svg+xml" } },
        );
      }
      if (url.href === designMd) {
        return new Response(
          'colors:\n  primary: "#a33421"\ntypography:\n  heading:\n    fontFamily: "Inter"',
        );
      }
      const blob = blobs.get(url.pathname.slice(1));
      if (url.origin === blobOrigin && blob) {
        return new Response(blob.bytes, {
          headers: { "content-type": blob.contentType },
        });
      }
      return new Response(null, { status: 404 });
    });
    external.submit.mockImplementation(() => ({
      kind: "queued",
      requestId: randomUUID(),
    }));
    external.download.mockResolvedValue({
      bytes: await sharp({
        create: { width: 160, height: 120, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
      contentType: "image/png",
    });
  });

  afterAll(async () => {
    if (projectId)
      await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("uses reviewed brand and catalog data in a paid batch and exports an authorized placement", async () => {
    const studio = app();
    const path = `/${projectId}/image-studio`;
    const draftResponse = await studio.request(`${path}/website-draft`, {
      method: "POST",
    });
    expect(draftResponse.status).toBe(200);
    const draft = studioWebsiteDraftSchema.parse(
      (await draftResponse.json()).data,
    );
    expect(draft.brandCopy).toMatchObject({
      summary: "Tools for brewing coffee.",
      lines: [approvedLine, unusedLine],
    });
    const products = draft.products ?? [];
    expect(products.map(({ name }) => name)).toEqual([
      "Pour-over set",
      "Travel mug",
    ]);
    expect(
      await prisma.projectStudioProductCatalog.count({ where: { projectId } }),
    ).toBe(0);

    const kitResponse = await studio.request(`${path}/brand-kit`);
    const kit = studioBrandKitSchema.parse((await kitResponse.json()).data);
    expect(kit).toMatchObject({
      logo: null,
      colors: ["#a33421"],
      fonts: ["Inter"],
      approvedLines: [],
    });
    const logoResponse = await studio.request(
      `${path}/brand-kit/logo/website`,
      { method: "POST" },
    );
    expect(logoResponse.status).toBe(200);
    const { logo } = (await logoResponse.json()).data;
    expect(logo).toContain(`/projects/${projectId}/logos/`);
    expect(
      await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { logo: true },
      }),
    ).toEqual({ logo: null });
    expect(
      (await studio.request(`/${projectId}`, json("PATCH", { logo }))).status,
    ).toBe(200);
    const logoPositionResponse = await studio.request(
      `/${projectId}`,
      json("PATCH", { studioLogoPosition: "bottom-left" }),
    );
    expect(logoPositionResponse.status).toBe(200);
    expect((await logoPositionResponse.json()).data).toMatchObject({
      logo,
      studioLogoPosition: "bottom-left",
    });
    const savedKit = await app().request(`${path}/brand-kit`);
    expect(savedKit.status).toBe(200);
    expect((await savedKit.json()).data).toMatchObject({
      logo,
      studioLogoPosition: "bottom-left",
    });
    expect(
      (
        await studio.request(
          `${path}/brand-kit`,
          json("PUT", {
            version: kit.version,
            copy: {
              summary: draft.brandCopy?.summary,
              tone: "Warm and direct",
              audience: ["Home brewers"],
              approvedLines: [approvedLine],
            },
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await studio.request(
          `${path}/products`,
          json("PUT", { revision: 0, products }),
        )
      ).status,
    ).toBe(200);

    const placementRatios = ["1:1", "9:16"];
    const submissions = products.flatMap((product) =>
      placementRatios.map((aspectRatio) => ({
        batchId,
        product: { id: product.id, name: product.name },
        modelId: "muse-image",
        settings: { aspectRatio },
        prompt: productBrief(product),
        idempotencyKey: randomUUID(),
      })),
    );
    for (const submission of submissions) {
      const response = await studio.request(
        `${path}/jobs`,
        json("POST", submission),
      );
      expect(response.status).toBe(201);
      const job = imageStudioJobSchema.parse((await response.json()).data);
      expect(job).toMatchObject({
        status: "QUEUED",
        product: submission.product,
      });
      await settleWithMedia(job.id, "https://fal.example/campaign.png");
    }
    const replay = await studio.request(
      `${path}/jobs`,
      json("POST", submissions[0]),
    );
    expect(replay.status).toBe(201);
    expect(external.submit).toHaveBeenCalledTimes(4);
    for (const [index, [payload]] of external.submit.mock.calls.entries()) {
      expect(payload.input.prompt).toContain(approvedLine);
      expect(payload.input.prompt).toContain("#a33421");
      expect(payload.input.prompt).toContain(submissions[index].product.name);
      expect(payload.input.prompt).not.toContain(unusedLine);
    }
    const jobs = await prisma.projectImageJob.findMany({
      where: { projectId, batchId },
    });
    expect(jobs).toHaveLength(4);
    expect(
      jobs.every(
        ({ status, transactionId }) => status === "SUCCEEDED" && transactionId,
      ),
    ).toBe(true);
    expect(new Set(jobs.map(({ transactionId }) => transactionId)).size).toBe(
      4,
    );

    const batchResponse = await studio.request(
      `${path}/batches/${batchId}/assets`,
    );
    expect(batchResponse.status).toBe(200);
    const assets = imageStudioAssetSchema
      .array()
      .parse((await batchResponse.json()).data);
    expect(assets).toHaveLength(4);
    for (const product of products) {
      expect(
        assets.filter(({ product: identity }) => identity?.id === product.id),
      ).toHaveLength(2);
    }
    const output = `${path}/assets/${assets[0].id}/content?placement=9%3A16&logo=top-left`;
    const png = await studio.request(output);
    expect(png.status).toBe(200);
    const { data, info } = await sharp(await png.arrayBuffer())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 63, height: 112, channels: 3 });
    const logoPixel = (4 * info.width + 4) * info.channels;
    expect([...data.subarray(logoPixel, logoPixel + 3)]).toEqual([163, 52, 33]);
    expect((await app(randomUUID()).request(output)).status).toBe(404);
  });
});
