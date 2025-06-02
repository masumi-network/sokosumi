import { v4 as uuidv4 } from "uuid";

import { getEnvPublicConfig, getEnvSecrets } from "@/config/env.config";
import { usdmUnit } from "@/lib/utils";
import { PrismaClient } from "@/prisma/generated/client";

import { hashPassword } from "./util/password";

const prisma = new PrismaClient();

const seedDatabase = getEnvSecrets().SEED_DATABASE;

const seedUser = async (): Promise<string> => {
  let user = await prisma.user.findFirst({
    where: {
      email: "dev@sokosumi.com",
    },
  });

  if (user) {
    console.log("User already exists, skipping...");
    return user.id;
  }

  user = await prisma.user.create({
    data: {
      email: getEnvSecrets().SEED_USER_EMAIL,
      name: "Sokosumi Developer",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  console.log(`User created with email ${user.email}`);

  const password = await hashPassword(getEnvSecrets().SEED_USER_PASSWORD);

  const account = await prisma.account.create({
    data: {
      id: uuidv4(),
      userId: user.id,
      providerId: "credential",
      accountId: uuidv4(),
      password: password,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  console.log(`Account created with id ${account.id}`);
  return user.id;
};

const seedUSDMCreditCost = async () => {
  console.log("Seeding credit cost...");
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
    await seedUser();
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
