import { createPolarCheckout } from "@/clients/polar.client";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import { serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { type CmoPlan, getCmoCatalog } from "@/services/cmo-catalog.service";
import {
  CmoConflictError,
  type Cuso,
  type CusoTarget,
  cmoPayer,
  requireCuso,
} from "@/services/cmo-cuso.service";
import type { CmoCheckoutMetadata } from "@/services/polar-subscription.service";

/**
 * Starts Polar's hosted checkout for a Cuso (ADR 0068), a plan or a top-up:
 * any member of his organization may pay. The organization is Polar's
 * customer; the metadata is what the paid order's grant reads
 * (`cmoCheckoutMetadataSchema`). `productsFor` refuses what the Cuso may not
 * buy and lists the products, the preselected one first.
 */
export async function startCmoCheckout(
  input: CusoTarget & { returnUrl: string },
  kind: "plan" | "top-up",
  productsFor: (cuso: Cuso) => Promise<string[]>,
): Promise<{ url: string }> {
  if (!isFirstPartyAppUrl(input.returnUrl)) {
    throw new CmoConflictError("The return address must be CMO's own page");
  }
  const cuso = await requireCuso(input);
  const { organizationId } = await cmoPayer(cuso);
  const productIds = await productsFor(cuso);
  const metadata: CmoCheckoutMetadata & { kind: typeof kind } = {
    kind,
    projectId: cuso.projectId,
    organizationId,
    userId: input.userId,
  };
  const url = await createPolarCheckout({
    productIds,
    organizationId,
    metadata,
    returnUrl: input.returnUrl,
  });
  return { url };
}

/**
 * Starts the checkout of a Cuso's CMO plan: the interval's plans, the
 * cheapest first unless the person picked a tier (Polar opens on the first).
 *
 * shortcut: two checkouts opened before either is paid can both be paid;
 * the second subscription is then revoked at Polar, reported and gets no
 * row (`polar_subscription_project_live_key`). Refund it by hand in Polar.
 */
export async function startCmoPlanCheckout(
  input: CusoTarget & {
    interval: CmoPlan["interval"];
    tier?: string | undefined;
    returnUrl: string;
  },
): Promise<{ url: string }> {
  return await startCmoCheckout(input, "plan", async (cuso) => {
    const subscription = await prisma.polarSubscription.findFirst({
      where: { projectId: cuso.projectId, endedAt: null },
      select: { id: true },
    });
    if (subscription) {
      throw new CmoConflictError("This Cuso already has a CMO subscription");
    }
    const plans = (await getCmoCatalog()).plans.filter(
      (plan) => plan.interval === input.interval,
    );
    if (plans.length === 0) {
      throw serviceUnavailable("CMO plans are not set up");
    }
    return [
      ...plans.filter((plan) => plan.tier === input.tier),
      ...plans.filter((plan) => plan.tier !== input.tier),
    ].map((plan) => plan.productId);
  });
}
