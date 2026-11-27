import { randomUUID } from "node:crypto";
import prisma from "@/lib/db/prisma";
import { forgetEvalWorkspaces } from "@/lib/evals/eval-guard";
import { connectEvalSocialAccount } from "../eval-social-accounts";
import type { CmoPathBrand } from "./types";

/** Lanes of the path test sit far above the benchmark's numbered lanes. */
const FIRST_PATH_LANE = 9000;

export interface CmoPathLane {
  lane: number;
  userId: string;
  organizationId: string;
  workspaceId: string;
  /** Set once Cuso is hired. */
  cusoBotId: string | null;
  cusoProjectId: string | null;
}

/**
 * A fresh customer for one brand on one run: the owner, an organization
 * with their Seat, and the eval lane row, made before anything else so
 * every guard and mock treats it as the eval world from the first request.
 * Its slug has the eval organizations' form (`sokosumi-evals-<lane>`).
 */
export async function createCmoPathLane(
  brand: CmoPathBrand,
): Promise<CmoPathLane> {
  const last = await prisma.evalLane.findFirst({
    where: { lane: { gte: FIRST_PATH_LANE } },
    orderBy: { lane: "desc" },
    select: { lane: true },
  });
  const lane = (last?.lane ?? FIRST_PATH_LANE - 1) + 1;
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      name: `${brand.owner.firstName} ${brand.owner.lastName}`,
      firstName: brand.owner.firstName,
      lastName: brand.owner.lastName,
      email: `evals+cmopath${lane}@sokosumi.com`,
      emailVerified: true,
      termsAccepted: true,
      notificationsOptIn: false,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  const organization = await prisma.organization.create({
    data: {
      name: brand.eval.name,
      slug: `sokosumi-evals-${lane}`,
      members: {
        create: { userId: user.id, role: "owner", seatAssignedAt: now },
      },
      workspace: { create: {} },
    },
    select: { id: true, workspace: { select: { id: true } } },
  });
  const workspaceId = organization.workspace?.id;
  if (!workspaceId) throw new Error(`Path lane ${lane} has no workspace`);
  await prisma.user.update({
    where: { id: user.id },
    data: { preferredOrganizationId: organization.id },
  });
  await prisma.evalLane.create({
    data: {
      lane,
      userId: user.id,
      organizationId: organization.id,
      workspaceId,
      // The Soko Bot slot is unused here; Cuso's id replaces it once hired.
      sokoBotId: randomUUID(),
      world: { cmoPath: brand.id },
    },
  });
  forgetEvalWorkspaces();
  return {
    lane,
    userId: user.id,
    organizationId: organization.id,
    workspaceId,
    cusoBotId: null,
    cusoProjectId: null,
  };
}

/** Records the hired Cuso on the lane and connects the brand's stand-in accounts. */
export async function attachCuso(
  lane: CmoPathLane,
  cuso: { sokoBotId: string; projectId: string },
): Promise<CmoPathLane> {
  await prisma.evalLane.update({
    where: { lane: lane.lane },
    data: {
      sokoBotId: cuso.sokoBotId,
      cusoBotId: cuso.sokoBotId,
      cusoProjectId: cuso.projectId,
    },
  });
  forgetEvalWorkspaces();
  return { ...lane, cusoBotId: cuso.sokoBotId, cusoProjectId: cuso.projectId };
}

export async function connectBrandAccounts(
  lane: CmoPathLane,
  brand: CmoPathBrand,
  projectId: string,
): Promise<void> {
  for (const network of brand.networks)
    await connectEvalSocialAccount({
      projectId,
      connectorUserId: lane.userId,
      network,
      key: `eval-${lane.lane}-${network}`,
      handle: brand.id,
      displayName: brand.eval.name,
    });
}
