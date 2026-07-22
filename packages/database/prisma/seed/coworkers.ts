import type { Prisma } from "../../src/generated/prisma/client.js";
import type { SeedContext } from "./context.js";
import {
  COWORKER_CAPTIONS,
  COWORKER_DISPLAY_NAMES,
  COWORKER_OFFERS,
  COWORKER_PRIORITY,
  COWORKER_PROFILE_SEED,
} from "./coworker-profile-data.js";
import { FIXTURE_VENDOR_SLUG, SEED_COWORKER_SLUGS } from "./fixtures.js";

function buildCoworkerMetadata(slug: string): Prisma.InputJsonValue {
  const seed = COWORKER_PROFILE_SEED[slug];
  return {
    channels: {},
    profile: {
      llm: seed.llm,
      hosting: seed.hosting,
      capabilities: seed.capabilities,
      examples: seed.examples,
    },
    offers: COWORKER_OFFERS[slug] ?? [],
  };
}

export async function seedCoworkers(ctx: SeedContext): Promise<void> {
  const { prisma, users } = ctx;

  const vendor = await prisma.vendor.upsert({
    where: { slug: FIXTURE_VENDOR_SLUG },
    create: {
      name: "Serviceplan",
      slug: FIXTURE_VENDOR_SLUG,
    },
    update: {
      name: "Serviceplan",
    },
  });

  for (const slug of SEED_COWORKER_SLUGS) {
    const profile = COWORKER_PROFILE_SEED[slug];
    const coworker = await prisma.coworker.upsert({
      where: { slug },
      create: {
        slug,
        name: COWORKER_DISPLAY_NAMES[slug] ?? slug,
        caption: COWORKER_CAPTIONS[slug] ?? null,
        description: profile.description,
        priority: COWORKER_PRIORITY[slug] ?? 0,
        isWhitelisted: true,
        capabilities: profile.capabilities,
        metadata: buildCoworkerMetadata(slug),
        userId: users.alice.id,
        vendorId: vendor.id,
      },
      update: {
        name: COWORKER_DISPLAY_NAMES[slug] ?? slug,
        caption: COWORKER_CAPTIONS[slug] ?? null,
        description: profile.description,
        priority: COWORKER_PRIORITY[slug] ?? 0,
        isWhitelisted: true,
        capabilities: profile.capabilities,
        metadata: buildCoworkerMetadata(slug),
        userId: users.alice.id,
        vendorId: vendor.id,
      },
    });

    ctx.coworkers[slug] = coworker;
  }
}
