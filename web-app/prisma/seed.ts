import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { usdmUnit } from "@/lib/utils";
import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

const seedDatabase = getEnvSecrets().SEED_DATABASE;

const seedUSDMCreditCost = async () => {
  console.log("Seeding USDM credit cost...");
  const unit = usdmUnit(getEnvPublicConfig().NEXT_PUBLIC_NETWORK);
  await prisma.creditCost.upsert({
    where: {
      unit,
    },
    update: {
      centsPerUnit: 1_000_000, // 1 base unit usdm == 0.000001 usdm == 1_000_000 credits
    },
    create: {
      unit,
      centsPerUnit: 1_000_000, // 1 base unit usdm == 0.000001 usdm == 1_000_000 credits
    },
  });
  console.log("USDM credit cost seeded");
};

const seedLoveLaceCreditCost = async () => {
  console.log("Seeding Lovelace credit cost...");
  await prisma.creditCost.upsert({
    where: {
      unit: "",
    },
    update: {
      centsPerUnit: 500_000, // 1 lovelace == 500_000 credits
    },
    create: {
      unit: "",
      centsPerUnit: 500_000, // 1 lovelace == 500_000 credits
    },
  });
  console.log("Lovelace credit cost seeded");
};

async function main() {
  await seedUSDMCreditCost();
  if (seedDatabase) {
    await seedLoveLaceCreditCost();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
