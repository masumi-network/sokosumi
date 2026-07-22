import { hashPassword } from "@better-auth/utils/password";

import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { seedBilling } from "./billing.js";
import { seedCatalog } from "./catalog.js";
import { createSeedContext } from "./context.js";
import { seedCoworkers } from "./coworkers.js";
import {
  FIXTURE_EMAILS,
  FIXTURE_ORG_SLUGS,
  FIXTURE_PASSWORD,
} from "./fixtures.js";
import { seedTasksAndJobs } from "./tasks-jobs.js";
import { seedUsersAndOrgs } from "./users-orgs.js";

export async function runSeed(prisma: PrismaClient): Promise<void> {
  const passwordHash = await hashPassword(FIXTURE_PASSWORD);
  const ctx = createSeedContext(prisma);

  await seedUsersAndOrgs(ctx, passwordHash);
  await seedBilling(ctx);
  await seedCatalog(ctx);
  await seedCoworkers(ctx);
  await seedTasksAndJobs(ctx);

  printSeedSummary();
}

function printSeedSummary(): void {
  console.log("\n=== Sokosumi local seed complete ===");
  console.log(`Password (all users): ${FIXTURE_PASSWORD}`);
  console.log("\nUsers:");
  console.log(`  admin  ${FIXTURE_EMAILS.admin}  (role: admin)`);
  console.log(
    `  alice  ${FIXTURE_EMAILS.alice}  (acme owner, pro sub, credits)`,
  );
  console.log(`  bob    ${FIXTURE_EMAILS.bob}    (acme member, lean credits)`);
  console.log(`  carol  ${FIXTURE_EMAILS.carol}  (solo user)`);
  console.log("\nOrganizations:");
  console.log(
    `  ${FIXTURE_ORG_SLUGS.acme}       alice owner, bob member, starter sub`,
  );
  console.log(`  ${FIXTURE_ORG_SLUGS.bootstrap}  alice owner, no paid sub`);
  console.log("\nSample routes:");
  console.log("  /agents   — catalog (categories + agents)");
  console.log("  /tasks    — seeded tasks (DRAFT, READY, COMPLETED)");
  console.log("  /chat     — coworker marketplace");
  console.log("  /organizations/acme/settings — org billing");
  console.log("\nRe-run safely: pnpm prisma:seed");
}
