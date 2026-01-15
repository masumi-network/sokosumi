import { createPrismaClient } from "@sokosumi/database/client";

const prisma = createPrismaClient(process.env.DATABASE_URL);
/**
 * Data migration: Set all network values to the defined network.
 *
 * This script updates all existing records in Agent, CreditCost, FiatTransaction, CreditTransaction, JobSchedule, and Job
 * tables to have the specified network value. By default, sets to MAINNET.
 *
 * To use a different network, set the NETWORK_MIGRATION_VALUE environment variable:
 * - MAINNET (default)
 * - PREPROD
 *
 * @example
 * DATABASE_URL="your_database_url" NETWORK_MIGRATION_VALUE=PREPROD pnpm exec tsx prisma/migrations/20260114213115_add_network_fields/data-migration.js
 */
async function main() {
  // Get network value from environment or default to MAINNET
  const networkValue = (
    process.env.NETWORK_MIGRATION_VALUE || "MAINNET"
  ).toUpperCase();

  if (networkValue !== "MAINNET" && networkValue !== "PREPROD") {
    throw new Error(
      `Invalid network value: ${networkValue}. Must be MAINNET or PREPROD`,
    );
  }

  console.log(`Setting all network values to: ${networkValue}`);

  // Update Agent table
  const agentResult = await prisma.$executeRaw`
    UPDATE "Agent"
    SET "network" = ${networkValue}::"Network"
    WHERE "network" IS NULL OR "network" != ${networkValue}::"Network"
  `;
  console.log(`Updated ${agentResult} agents to network ${networkValue}`);

  // Update CreditCost table
  const creditCostResult = await prisma.$executeRaw`
    UPDATE "CreditCost"
    SET "network" = ${networkValue}::"Network"
    WHERE "network" IS NULL OR "network" != ${networkValue}::"Network"
  `;
  console.log(
    `Updated ${creditCostResult} credit costs to network ${networkValue}`,
  );

  // Update CreditTransaction table
  const creditTransactionResult = await prisma.$executeRaw`
    UPDATE "CreditTransaction"
    SET "network" = ${networkValue}::"Network"
    WHERE "network" IS NULL OR "network" != ${networkValue}::"Network"
    `;
  console.log(
    `Updated ${creditTransactionResult} credit transactions to network ${networkValue}`,
  );

  // Update JobSchedule table
  const jobScheduleResult = await prisma.$executeRaw`
    UPDATE "jobSchedule"
    SET "network" = ${networkValue}::"Network"
    WHERE "network" IS NULL OR "network" != ${networkValue}::"Network"
    `;
  console.log(
    `Updated ${jobScheduleResult} job schedules to network ${networkValue}`,
  );

  // Update Job table (optional, but recommended for consistency)
  const jobResult = await prisma.$executeRaw`
    UPDATE "Job"
    SET "network" = ${networkValue}::"Network"
    WHERE "network" IS NULL
    `;
  console.log(`Updated ${jobResult} jobs to network ${networkValue}`);

  const totalUpdated =
    Number(agentResult) +
    Number(creditCostResult) +
    Number(creditTransactionResult) +
    Number(jobScheduleResult) +
    Number(jobResult);
  console.log(`\n✅ Migration complete: Updated ${totalUpdated} total records`);
}

main()
  .catch(async (e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });
