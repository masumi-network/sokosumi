import {
  CMO_MEASUREMENT_SOURCES,
  type CmoMeasurementSource,
  isCmoMeasurementSource,
} from "@sokosumi/soko-bot";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import prisma from "@/lib/db/prisma";
import type { SitePlatform } from "@/lib/site-platform";
import {
  CmoConflictError,
  CmoNotFoundError,
  type Cuso,
  requireCuso,
} from "@/services/cmo-cuso.service";

/**
 * Reads once what the site runs on, onto the Project next to its website, so
 * Shopify is offered only to shops.
 */
export async function learnCmoSitePlatform(
  cuso: Pick<Cuso, "projectId" | "websiteUrl">,
): Promise<void> {
  const { detectSitePlatform } = await import("@/lib/site-platform");
  const platform = await detectSitePlatform(cuso.websiteUrl).catch(() => null);
  if (!platform) return;
  await prisma.project.update({
    where: { id: cuso.projectId },
    data: { sitePlatform: platform },
  });
}

/** The site platform with a measurement source of its own. */
const SHOPIFY = "shopify" satisfies SitePlatform;

/** A measurement source and whether it is connected to Cuso. */
export interface CmoMeasurementStatus {
  provider: CmoMeasurementSource;
  name: string;
  measures: string;
  status: "connected" | "pending" | "none";
}

/**
 * Google Analytics, Search Console and, for a Shopify shop, Shopify, as
 * connected to Cuso's bot.
 */
export async function listCmoMeasurement(
  sokoBotId: string,
  sitePlatform: string | null,
): Promise<CmoMeasurementStatus[]> {
  const rows = await prisma.sokoBotIntegration.findMany({
    where: {
      sokoBotId,
      provider: { in: CMO_MEASUREMENT_SOURCES.map((source) => source.id) },
    },
    select: { provider: true, status: true },
  });
  const sources = CMO_MEASUREMENT_SOURCES.filter(
    (source) => source.id !== SHOPIFY || sitePlatform === SHOPIFY,
  );
  return sources.map((source) => {
    const row = rows.find((candidate) => candidate.provider === source.id);
    return {
      provider: source.id,
      name: source.name,
      measures: source.measures,
      status: !row ? "none" : row.status === "ACTIVE" ? "connected" : "pending",
    };
  });
}

/**
 * Starts connecting a measurement source to Cuso's own bot (not the owner's
 * personal assistant): the owner authorizes it and comes back to returnUrl.
 */
export async function connectCmoMeasurement(input: {
  userId: string;
  provider: string;
  returnUrl: string;
}): Promise<{ redirectUrl: string }> {
  if (!isCmoMeasurementSource(input.provider)) {
    throw new CmoNotFoundError("CMO does not measure with that source");
  }
  if (!isFirstPartyAppUrl(input.returnUrl)) {
    throw new CmoConflictError("The return address must be CMO's own page");
  }
  const cuso = await requireCuso({ userId: input.userId });
  const project = await prisma.project.findUnique({
    where: { id: cuso.projectId },
    select: { sitePlatform: true },
  });
  if (input.provider === SHOPIFY && project?.sitePlatform !== SHOPIFY) {
    throw new CmoConflictError("Shopify measures Shopify shops only");
  }
  const { connectSokoBotIntegration } = await import(
    "@/services/soko-bot-integration-connection.service"
  );
  return connectSokoBotIntegration({
    userId: input.userId,
    workspaceId: cuso.workspaceId,
    provider: input.provider,
    returnUrl: input.returnUrl,
    selector: { kind: "id", sokoBotId: cuso.sokoBotId },
  });
}

/** Finishes a measurement connection once the owner is back from authorizing. */
export async function finalizeCmoMeasurement(input: {
  userId: string;
  provider: string;
}): Promise<void> {
  if (!isCmoMeasurementSource(input.provider)) {
    throw new CmoNotFoundError("CMO does not measure with that source");
  }
  const cuso = await requireCuso({ userId: input.userId });
  const { finalizeSokoBotIntegration } = await import(
    "@/services/soko-bot-integration-connection.service"
  );
  await finalizeSokoBotIntegration({
    userId: input.userId,
    workspaceId: cuso.workspaceId,
    provider: input.provider,
    selector: { kind: "id", sokoBotId: cuso.sokoBotId },
  });
}
