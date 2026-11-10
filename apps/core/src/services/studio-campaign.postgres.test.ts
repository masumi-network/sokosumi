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
  uploadReference: vi.fn(),
  driveHead: vi.fn(),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "campaign-public-fixture",
      IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "campaign-private-fixture",
      IMAGE_STUDIO_AGENT_SECRET: "campaign-fixture-agent-secret".repeat(2),
      AI_GATEWAY_API_KEY: undefined,
    }),
    getBetterAuthPublicBaseUrl: () => "https://core.example.test",
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
vi.mock("@/lib/drive-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-blob")>()),
  driveHead: external.driveHead,
}));
vi.mock("@/lib/image-studio/fal-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-studio/fal-client")>()),
  submitToQueue: external.submit,
  downloadMedia: external.download,
  uploadReference: external.uploadReference,
}));
vi.mock("@/services/image-studio-drive.service", () => ({
  publishStudioAssetToFiles: vi.fn(),
  writeStudioDriveFile: vi.fn(),
}));

import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import { mintAgentGrant } from "@/lib/image-studio/agent-grant";
import { STUDIO_MCP_PATH } from "@/lib/image-studio/studio-connection";
import legacyAgentRoutes from "@/routes/image-studio-agent/index";
import agentRoutes from "@/routes/v1/image-studio-agent/index";
import mcpRoutes from "@/routes/v1/image-studio-mcp/index";
import mountAssetContent from "@/routes/v1/projects/[id]/image-studio/asset-content-get";
import mountAssetHeadline from "@/routes/v1/projects/[id]/image-studio/asset-headline-put";
import mountBatchAssets from "@/routes/v1/projects/[id]/image-studio/batch-assets-get";
import mountBrandKit from "@/routes/v1/projects/[id]/image-studio/brand-kit";
import mountWebsiteLogo from "@/routes/v1/projects/[id]/image-studio/brand-logo-website-post";
import mountConnection from "@/routes/v1/projects/[id]/image-studio/connection";
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
const secondApprovedLine = "Good coffee for slower mornings.";
const unusedLine = "An old promotion";
const userId = randomUUID();
const batchId = randomUUID();

let workspaceId: string;
let projectId: string;

function app(actorId = userId) {
  const server = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
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
  server.onError(errorHandler);
  server.route("/v1/image-studio-agent", agentRoutes);
  server.route(`/v1${STUDIO_MCP_PATH}`, mcpRoutes);
  server.route("/image-studio-agent", legacyAgentRoutes);
  mountBrandKit(server);
  mountWebsiteLogo(server);
  mountConnection(server);
  mountPatchProject(server);
  mountSaveProducts(server);
  mountJobs(server);
  mountBatchAssets(server);
  mountAssetContent(server);
  mountAssetHeadline(server);
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
    external.uploadReference.mockResolvedValue(
      "https://fal.example/reference.png",
    );
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
      lookRevision: 0,
      hasCustomLook: false,
    });
    const lookPath = `${path}/brand-kit/look`;
    const customLook = { colors: ["#134"], fonts: ["Source Serif 4"] };
    const savedLook = await studio.request(
      lookPath,
      json("PUT", { look: customLook, lookRevision: 0 }),
    );
    expect(savedLook.status).toBe(200);
    const savedLookState = {
      colors: ["#113344"],
      fonts: customLook.fonts,
      lookRevision: 1,
      hasCustomLook: true,
    };
    expect((await savedLook.json()).data).toEqual(savedLookState);
    expect(
      (
        await studio.request(
          lookPath,
          json("PUT", { look: null, lookRevision: 0 }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await studio.request(
          lookPath,
          json("PUT", {
            look: { colors: ["orange"], fonts: [] },
            lookRevision: 1,
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await app(randomUUID()).request(
          lookPath,
          json("PUT", { look: null, lookRevision: 1 }),
        )
      ).status,
    ).toBe(404);
    const customKit = await studio.request(`${path}/brand-kit`);
    expect((await customKit.json()).data).toMatchObject(savedLookState);
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
              approvedLines: [approvedLine, secondApprovedLine],
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
    const submissions = products.flatMap((product, index) =>
      placementRatios.map((aspectRatio) => ({
        batchId,
        product: { id: product.id, name: product.name },
        exportHeadline: index === 0 ? approvedLine : secondApprovedLine,
        modelId: "muse-image",
        settings: { aspectRatio },
        prompt: productBrief(product),
        idempotencyKey: randomUUID(),
      })),
    );
    const unapproved = await studio.request(
      `${path}/jobs`,
      json("POST", { ...submissions[0], exportHeadline: unusedLine }),
    );
    expect(unapproved.status).toBe(422);
    expect(external.submit).not.toHaveBeenCalled();
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
      expect(payload.input.prompt).not.toContain(approvedLine);
      expect(payload.input.prompt).not.toContain(secondApprovedLine);
      expect(payload.input.prompt).toContain("#a33421");
      expect(payload.input.prompt).toContain("Palette: #113344");
      expect(payload.input.prompt).toContain("Fonts: Source Serif 4");
      expect(payload.input.prompt).toContain(submissions[index].product.name);
      expect(payload.input.prompt).toContain("Keep the upper area clear");
      expect(payload.input.prompt).not.toContain(unusedLine);
    }
    const resetLook = await studio.request(
      lookPath,
      json("PUT", { look: null, lookRevision: 1 }),
    );
    expect(resetLook.status).toBe(200);
    expect((await resetLook.json()).data).toEqual({
      colors: ["#a33421"],
      fonts: ["Inter"],
      lookRevision: 2,
      hasCustomLook: false,
    });
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
    for (const [index, product] of products.entries()) {
      const results = assets.filter(
        ({ product: identity }) => identity?.id === product.id,
      );
      expect(results).toHaveLength(2);
      expect(results.map(({ headline }) => headline)).toEqual(
        Array.from({ length: 2 }, () => ({
          text: index === 0 ? approvedLine : secondApprovedLine,
          revision: 1,
        })),
      );
    }
    const firstAd = assets.find(
      ({ headline }) => headline?.text === approvedLine,
    );
    if (!firstAd) throw new Error("The first approved headline was not saved");
    const headlinePath = `${path}/assets/${firstAd.id}/headline`;
    const saveHeadline = (text: string | null, actor = studio) =>
      actor.request(headlinePath, json("PUT", { text }));
    expect((await saveHeadline(unusedLine)).status).toBe(422);
    expect((await saveHeadline(approvedLine, app(randomUUID()))).status).toBe(
      404,
    );
    const savedHeadline = await saveHeadline(approvedLine);
    expect(savedHeadline.status).toBe(200);
    expect((await savedHeadline.json()).data).toEqual({
      text: approvedLine,
      revision: 1,
    });
    expect((await (await saveHeadline(approvedLine)).json()).data).toEqual({
      text: approvedLine,
      revision: 1,
    });
    const readBatch = () => app().request(`${path}/batches/${batchId}/assets`);
    expect((await (await readBatch()).json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstAd.id,
          headline: { text: approvedLine, revision: 1 },
        }),
      ]),
    );
    expect((await (await saveHeadline(null)).json()).data).toEqual({
      text: null,
      revision: 2,
    });
    expect((await (await readBatch()).json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstAd.id,
          headline: { text: null, revision: 2 },
        }),
      ]),
    );
    const agentPath = `/v1/image-studio-agent/assets/${firstAd.id}/headline`;
    const agentAuth = (
      audience: "agent" | "browser" = "agent",
      actorId = userId,
    ) => ({
      authorization: `Bearer ${mintAgentGrant(
        { userId: actorId, projectId, audience, ttlSeconds: 120 },
        "campaign-fixture-agent-secret".repeat(2),
      )}`,
    });
    const agentRead = await studio.request(agentPath, { headers: agentAuth() });
    expect(agentRead.status).toBe(200);
    expect((await agentRead.json()).data).toEqual({
      headline: { text: null, revision: 2 },
      approvedLines: [approvedLine, secondApprovedLine],
    });
    expect(
      (await studio.request(agentPath, { headers: agentAuth("browser") }))
        .status,
    ).toBe(401);
    expect(
      (
        await studio.request(agentPath, {
          headers: agentAuth("agent", randomUUID()),
        })
      ).status,
    ).toBe(404);
    const changeFromChat = (text: string | null, expectedRevision: number) =>
      studio.request(agentPath, {
        method: "PUT",
        headers: { ...agentAuth(), "content-type": "application/json" },
        body: JSON.stringify({ text, expectedRevision }),
      });
    expect((await changeFromChat(unusedLine, 2)).status).toBe(422);
    const updated = await changeFromChat(secondApprovedLine, 2);
    expect(updated.status).toBe(200);
    expect((await updated.json()).data).toEqual({
      text: secondApprovedLine,
      revision: 3,
    });
    expect((await changeFromChat(approvedLine, 2)).status).toBe(409);
    expect((await changeFromChat(secondApprovedLine, 2)).status).toBe(200);
    expect((await (await readBatch()).json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstAd.id,
          headline: { text: secondApprovedLine, revision: 3 },
        }),
      ]),
    );
    expect(external.submit).toHaveBeenCalledTimes(4);

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

    const refinement = {
      prompt: "Use a darker background and keep the layout.",
      parentAssetId: firstAd.id,
      referenceAssetIds: [firstAd.id],
      modelId: "muse-image",
    };
    const fromAssistant = () =>
      studio.request("/image-studio-agent/generations", {
        method: "POST",
        headers: { ...agentAuth(), "content-type": "application/json" },
        body: JSON.stringify({
          ...refinement,
          aspectRatio: "9:16",
          idempotencyKey: randomUUID(),
        }),
      });
    const fromBrowser = (
      product = firstAd.product,
      parentAssetId = firstAd.id,
      explicitBatchId?: string,
    ) =>
      studio.request(
        `${path}/jobs`,
        json("POST", {
          ...refinement,
          parentAssetId,
          referenceAssetIds: [parentAssetId],
          batchId: explicitBatchId,
          product,
          settings: { aspectRatio: "9:16" },
          idempotencyKey: randomUUID(),
        }),
      );
    const finishRevision = async (
      response: Response,
      expectedHeadline: string | null,
      expectedParentId = firstAd.id,
    ) => {
      expect(response.ok).toBe(true);
      const body = await response.json();
      const job = body.data ?? body.job;
      expect(job).toMatchObject({ status: "QUEUED" });
      await settleWithMedia(job.id, "https://fal.example/campaign.png");
      const result = await prisma.projectImageAsset.findUniqueOrThrow({
        where: { jobId: job.id },
        select: {
          id: true,
          parentId: true,
          rootId: true,
          headline: true,
          job: { select: { batchSlotId: true } },
        },
      });
      expect(result.parentId).toBe(expectedParentId);
      expect(result.rootId).toBe(firstAd.rootId);
      if (expectedHeadline) {
        expect(result.headline).toMatchObject({
          text: expectedHeadline,
          revision: 1,
        });
        expect(external.submit.mock.lastCall?.[0].input.prompt).toContain(
          "Keep the upper area clear",
        );
      } else {
        expect(result.headline).toBeNull();
      }
      return result;
    };
    const pendingRevision = await fromAssistant();
    const expectedBatch = async (replacementId: string) => {
      const response = await readBatch();
      expect(response.status).toBe(200);
      const ready = imageStudioAssetSchema
        .array()
        .parse((await response.json()).data);
      expect(new Set(ready.map(({ id }) => id))).toEqual(
        new Set(
          assets.map(({ id }) => (id === firstAd.id ? replacementId : id)),
        ),
      );
      expect(ready).toHaveLength(assets.length);
      expect(ready.every((asset) => asset.batchId === batchId)).toBe(true);
    };
    await expectedBatch(firstAd.id);
    const firstRevision = await finishRevision(
      pendingRevision,
      secondApprovedLine,
    );
    expect(firstRevision.job.batchSlotId).toBe(firstAd.jobId);
    await expectedBatch(firstRevision.id);
    const laterRevision = await finishRevision(
      await fromBrowser(firstAd.product, firstRevision.id),
      secondApprovedLine,
      firstRevision.id,
    );
    expect(laterRevision.job.batchSlotId).toBe(firstAd.jobId);
    await expectedBatch(laterRevision.id);
    const replacement = products.find(({ id }) => id !== firstAd.product?.id);
    if (!replacement)
      throw new Error("A different product is required for the swap");
    const swapped = await finishRevision(
      await fromBrowser({ id: replacement.id, name: replacement.name }),
      null,
    );
    await expectedBatch(swapped.id);

    const anotherBatchId = randomUUID();
    const independentAds = [];
    for (let index = 0; index < 2; index++) {
      const revision = await finishRevision(
        await fromBrowser(firstAd.product, firstAd.id, anotherBatchId),
        secondApprovedLine,
      );
      expect(revision.job.batchSlotId).toBeNull();
      independentAds.push(revision.id);
    }
    const anotherBatch = await studio.request(
      `${path}/batches/${anotherBatchId}/assets`,
    );
    expect(anotherBatch.status).toBe(200);
    const independent = imageStudioAssetSchema
      .array()
      .parse((await anotherBatch.json()).data);
    expect(new Set(independent.map(({ id }) => id))).toEqual(
      new Set(independentAds),
    );
    await expectedBatch(swapped.id);

    const currentKit = studioBrandKitSchema.parse(
      (await (await studio.request(`${path}/brand-kit`)).json()).data,
    );
    const revoke = await studio.request(
      `${path}/brand-kit`,
      json("PUT", {
        version: currentKit.version,
        copy: {
          summary: currentKit.summary,
          tone: currentKit.tone,
          audience: currentKit.audience,
          approvedLines: [approvedLine],
        },
      }),
    );
    expect(revoke.status).toBe(200);
    const withoutHeadline = await finishRevision(await fromAssistant(), null);
    await expectedBatch(withoutHeadline.id);
  });

  it("shares one project's brand and catalog over MCP until the connection expires or is revoked", async () => {
    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: "Assistant demo",
        websiteUrl: shop,
        designMdUrl: designMd,
        studioBrandLook: { colors: ["#123456"], fonts: ["Source Serif 4"] },
      },
    });
    const studio = app();
    const path = `/${project.id}/image-studio`;
    const connectionPath = `${path}/connection`;
    const endpoint = `/v1${STUDIO_MCP_PATH}`;
    function mcp(
      token: string,
      method: string,
      params: Record<string, unknown> = {},
      headers?: Record<string, string>,
    ) {
      return studio.request(endpoint, {
        ...json("POST", { jsonrpc: "2.0", id: 1, method, params }),
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          ...headers,
        },
      });
    }
    async function result(response: Response) {
      expect(response.status).toBe(200);
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const message = (await response.text())
          .split("\n")
          .find((line) => line.startsWith("data: {"));
        return JSON.parse(message?.slice(6) ?? "null");
      }
      return response.json();
    }
    async function connect() {
      const response = await studio.request(connectionPath, { method: "POST" });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const { data } = await response.json();
      expect(data.url).toBe(`https://core.example.test${endpoint}`);
      expect(data.token).toMatch(/^studio_[\w-]{43}$/);
      return data;
    }
    try {
      const productId = randomUUID();
      const product = {
        id: productId,
        name: "Fieldwork Travel Mug",
        description: "Insulated steel.",
        price: "$20",
        url: null,
        imageUrl: null,
      };
      expect(
        (
          await studio.request(
            `${path}/products`,
            json("PUT", {
              revision: 0,
              products: [product],
            }),
          )
        ).status,
      ).toBe(200);
      expect(
        (await app(randomUUID()).request(connectionPath, { method: "POST" }))
          .status,
      ).toBe(404);
      const denied = await mcp("wrong-token", "tools/list");
      expect(denied.status).toBe(401);
      expect(denied.headers.get("www-authenticate")).toBe("Bearer");

      const { token, expiresAt } = await connect();
      const status = await studio.request(connectionPath);
      expect((await status.json()).data).toEqual({
        url: `https://core.example.test${endpoint}`,
        expiresAt,
      });
      expect(
        (
          await mcp(
            token,
            "tools/list",
            {},
            { origin: "https://another.example" },
          )
        ).status,
      ).toBe(403);
      const initialized = await result(
        await mcp(token, "initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "fixture", version: "1" },
        }),
      );
      expect(initialized.result.serverInfo.name).toBe(
        "sokosumi-content-studio",
      );
      const tools = await result(await mcp(token, "tools/list"));
      expect(
        tools.result.tools.map((tool: { name: string }) => tool.name).sort(),
      ).toEqual(["get_brand_kit", "list_products", "research_website"]);
      const brand = await result(
        await mcp(token, "tools/call", {
          name: "get_brand_kit",
          arguments: {},
        }),
      );
      expect(brand.result.structuredContent).toMatchObject({
        colors: ["#123456"],
        fonts: ["Source Serif 4"],
      });
      const crossProject = await result(
        await mcp(token, "tools/call", {
          name: "get_brand_kit",
          arguments: { projectId },
        }),
      );
      expect(crossProject.result.isError).toBe(true);
      const catalog = await result(
        await mcp(token, "tools/call", {
          name: "list_products",
          arguments: {},
        }),
      );
      expect(catalog.result.structuredContent).toEqual({
        products: [
          {
            id: productId,
            name: product.name,
            description: product.description,
            price: product.price,
            hasPhoto: false,
          },
        ],
      });
      const research = await result(
        await mcp(token, "tools/call", {
          name: "research_website",
          arguments: {},
        }),
      );
      expect(research.result.structuredContent.products).toHaveLength(2);

      const next = await connect();
      expect((await mcp(token, "tools/list")).status).toBe(401);
      await prisma.user.update({
        where: { id: userId },
        data: { banned: true },
      });
      try {
        expect((await mcp(next.token, "tools/list")).status).toBe(401);
      } finally {
        await prisma.user.update({
          where: { id: userId },
          data: { banned: false },
        });
      }
      await prisma.projectStudioConnection.update({
        where: { projectId_userId: { projectId: project.id, userId } },
        data: { expiresAt: new Date(0) },
      });
      expect((await mcp(next.token, "tools/list")).status).toBe(401);
      const final = await connect();
      expect(
        (await studio.request(connectionPath, { method: "DELETE" })).status,
      ).toBe(204);
      expect((await mcp(final.token, "tools/list")).status).toBe(401);
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it("composites a verified product cutout into the delivered artwork and checks the file again", async () => {
    const path = `/${projectId}/image-studio`;
    const studio = app();
    const width = 20;
    const height = 30;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const offset = (y * width + x) * 4;
        const label = y >= 10 && y < 14;
        pixels.set(label ? [246, 197, 27, 255] : [31, 104, 163, 255], offset);
      }
    }
    const cutout = new Uint8Array(
      await sharp(pixels, {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toBuffer(),
    );
    const opaque = new Uint8Array(
      await sharp({
        create: { width, height, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer(),
    );
    const sourceId = "drive/campaign-fixture/product-cutout.png";
    const fileUrl =
      "https://campaign.public.blob.vercel-storage.com/drive/campaign-fixture/product-cutout.png";
    const file = await prisma.fileResource.create({
      data: {
        workspaceId,
        sourceKind: "DRIVE_UPLOAD",
        sourceScope: "USER",
        ownerUserId: userId,
        sourceId,
        displayName: "product-cutout.png",
        normalizedName: "product-cutout.png",
        mimeType: "image/png",
        sizeBytes: cutout.length,
        lifecycle: "ACTIVE",
      },
    });
    let served = opaque;
    external.driveHead.mockImplementation((pathname) =>
      pathname === sourceId
        ? { access: "public", url: fileUrl, size: served.length }
        : null,
    );
    const fetchPhoto = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        expect(String(url)).toBe(fileUrl);
        return new Response(served, {
          headers: { "content-type": "image/png" },
        });
      });
    try {
      const requestCutout = async () => {
        const response = await studio.request(
          `${path}/jobs`,
          json("POST", {
            prompt: "A clean studio tabletop for a coffee ad.",
            modelId: "muse-image",
            useProductCutout: true,
            referenceFileIds: [file.id],
            idempotencyKey: randomUUID(),
          }),
        );
        expect(response.status).toBe(201);
        return imageStudioJobSchema.parse((await response.json()).data);
      };
      const previousSubmissions = external.submit.mock.calls.length;
      const rejected = await requestCutout();
      expect(rejected).toMatchObject({
        status: "FAILED",
        failureReason: "product_cutout_unavailable",
      });
      expect(external.submit).toHaveBeenCalledTimes(previousSubmissions);

      served = cutout;
      const previousUploads = external.uploadReference.mock.calls.length;
      const accepted = await requestCutout();
      expect(accepted).toMatchObject({
        kind: "GENERATE",
        status: "QUEUED",
        useProductCutout: true,
      });
      expect(external.uploadReference).toHaveBeenCalledTimes(previousUploads);
      expect(external.submit.mock.lastCall?.[0].input.prompt).toContain(
        "empty advertising backdrop",
      );
      const backdrop = async (background: string) =>
        new Uint8Array(
          await sharp({
            create: { width: 160, height: 120, channels: 3, background },
          })
            .png()
            .toBuffer(),
        );
      const originalBackdrop = await backdrop("white");
      external.download.mockResolvedValueOnce({
        bytes: originalBackdrop,
        contentType: "image/png",
      });
      await settleWithMedia(accepted.id, "https://fal.example/campaign.png");
      const asset = await prisma.projectImageAsset.findUniqueOrThrow({
        where: { jobId: accepted.id },
      });
      const response = await studio.request(
        `${path}/assets/${asset.id}/content`,
      );
      expect(response.status).toBe(200);
      const { data, info } = await sharp(await response.arrayBuffer())
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info).toMatchObject({ width: 160, height: 120 });
      const pixel = (x: number, y: number) => [
        ...data.subarray(
          (y * info.width + x) * 3,
          (y * info.width + x) * 3 + 3,
        ),
      ];
      const left = (info.width - width) / 2;
      const top = Math.floor(info.height * 0.86) - height;
      expect(pixel(left, top)).toEqual([255, 255, 255]);
      expect(pixel(left + 6, top + 6)).toEqual([31, 104, 163]);
      expect(pixel(left + 8, top + 12)).toEqual([246, 197, 27]);

      const requestBackdropEdit = (
        assistant: boolean,
        parentAssetId: string,
      ) => {
        const payload = {
          prompt: "Make the backdrop darker.",
          modelId: "muse-image",
          parentAssetId,
          referenceAssetIds: [parentAssetId],
          idempotencyKey: randomUUID(),
        };
        if (!assistant)
          return studio.request(`${path}/jobs`, json("POST", payload));
        const grant = mintAgentGrant(
          { userId, projectId, audience: "agent", ttlSeconds: 120 },
          "campaign-fixture-agent-secret".repeat(2),
        );
        return studio.request("/image-studio-agent/generations", {
          ...json("POST", payload),
          headers: {
            authorization: `Bearer ${grant}`,
            "content-type": "application/json",
          },
        });
      };
      let parentId = asset.id;
      let parentBackdrop = originalBackdrop;
      const darkerBackdrop = await backdrop("#8f2a20");
      for (const assistant of [false, true]) {
        const edited = await requestBackdropEdit(assistant, parentId);
        expect(edited.status).toBe(assistant ? 200 : 201);
        const body = await edited.json();
        const job = body.data ?? body.job;
        expect(job.status).toBe("QUEUED");
        const upload = external.uploadReference.mock.lastCall?.[0];
        expect(new Uint8Array(upload.bytes)).toEqual(parentBackdrop);
        expect(external.submit.mock.lastCall?.[0].input.prompt).toContain(
          "Edit the supplied advertising backdrop",
        );
        external.download.mockResolvedValueOnce({
          bytes: darkerBackdrop,
          contentType: "image/png",
        });
        await settleWithMedia(job.id, "https://fal.example/campaign.png");
        const version = await prisma.projectImageAsset.findUniqueOrThrow({
          where: { jobId: job.id },
        });
        expect(version).toMatchObject({
          parentId,
          rootId: asset.rootId,
          backdropContentType: "image/png",
        });
        const editedAd = await studio.request(
          `${path}/assets/${version.id}/content`,
        );
        const composed = await sharp(await editedAd.arrayBuffer())
          .removeAlpha()
          .raw()
          .toBuffer();
        const at = (x: number, y: number) => [
          ...composed.subarray(
            (y * info.width + x) * 3,
            (y * info.width + x) * 3 + 3,
          ),
        ];
        expect(at(left, top)).toEqual([143, 42, 32]);
        expect(at(left + 8, top + 12)).toEqual([246, 197, 27]);
        parentId = version.id;
        parentBackdrop = darkerBackdrop;
      }
      expect(external.uploadReference).toHaveBeenCalledTimes(
        previousUploads + 2,
      );

      const changed = await requestCutout();
      expect(changed.status).toBe("QUEUED");
      served = new Uint8Array(
        await sharp(cutout).modulate({ brightness: 0.8 }).png().toBuffer(),
      );
      const sentBeforeChangedEdit = external.submit.mock.calls.length;
      const changedEdit = await requestBackdropEdit(false, parentId);
      expect((await changedEdit.json()).data).toMatchObject({
        status: "FAILED",
        failureReason: "product_cutout_unavailable",
      });
      expect(external.submit).toHaveBeenCalledTimes(sentBeforeChangedEdit);
      await settleWithMedia(changed.id, "https://fal.example/campaign.png");
      expect(
        await prisma.projectImageJob.findUniqueOrThrow({
          where: { id: changed.id },
          select: {
            status: true,
            asset: true,
            transactionId: true,
            failureReason: true,
          },
        }),
      ).toEqual({
        status: "FAILED",
        asset: null,
        transactionId: null,
        failureReason: "product_cutout_unavailable",
      });

      served = cutout;
      const revoked = await requestCutout();
      expect(revoked.status).toBe("QUEUED");
      await prisma.fileResource.update({
        where: { id: file.id },
        data: { tombstonedAt: new Date() },
      });
      await settleWithMedia(revoked.id, "https://fal.example/campaign.png");
      expect(
        await prisma.projectImageJob.findUniqueOrThrow({
          where: { id: revoked.id },
          select: {
            status: true,
            asset: true,
            transactionId: true,
            failureReason: true,
          },
        }),
      ).toEqual({
        status: "FAILED",
        asset: null,
        transactionId: null,
        failureReason: "product_cutout_unavailable",
      });
    } finally {
      fetchPhoto.mockRestore();
    }
  });
});
