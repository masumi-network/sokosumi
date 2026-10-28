import {
  CMO_MEASUREMENT_SOURCES,
  type CmoMeasurementSource,
  isCmoMeasurementSource,
} from "@sokosumi/soko-bot";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import prisma from "@/lib/db/prisma";
import {
  CmoConflictError,
  type CmoHireView,
  CmoNotFoundError,
  getCmoHireForUser,
} from "@/services/cmo-cuso.service";

/** Reads once what the site runs on, so Shopify is offered only to shops. */
export async function learnCmoSitePlatform(
  hire: Pick<CmoHireView, "id" | "websiteUrl">,
): Promise<void> {
  const { detectSitePlatform } = await import("@/lib/site-platform");
  const platform = await detectSitePlatform(hire.websiteUrl).catch(() => null);
  if (!platform) return;
  await prisma.cmoHire.update({
    where: { id: hire.id },
    data: { sitePlatform: platform },
  });
}

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
    (source) => source.id !== "shopify" || sitePlatform === "shopify",
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
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  if (input.provider === "shopify" && hire.sitePlatform !== "shopify") {
    throw new CmoConflictError("Shopify measures Shopify shops only");
  }
  const { connectSokoBotIntegration } = await import(
    "@/services/soko-bot-integration-connection.service"
  );
  return connectSokoBotIntegration({
    userId: input.userId,
    workspaceId: hire.workspaceId,
    provider: input.provider,
    returnUrl: input.returnUrl,
    selector: { kind: "id", sokoBotId: hire.sokoBotId },
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
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const { finalizeSokoBotIntegration } = await import(
    "@/services/soko-bot-integration-connection.service"
  );
  await finalizeSokoBotIntegration({
    userId: input.userId,
    workspaceId: hire.workspaceId,
    provider: input.provider,
    selector: { kind: "id", sokoBotId: hire.sokoBotId },
  });
}
