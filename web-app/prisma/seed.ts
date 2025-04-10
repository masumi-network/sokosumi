import crypto from "crypto";

import { getEnvSecrets } from "@/config/env.config";
import { convertCreditsToBaseUnits } from "@/lib/db/utils/credit.utils";
import {
  CreditTransactionStatus,
  CreditTransactionType,
  PrismaClient,
} from "@/prisma/generated/client";

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
      id: crypto.randomUUID(),
      userId: user.id,
      providerId: "credential",
      accountId: crypto.randomUUID(),
      password: password,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  console.log(`Account created with id ${account.id}`);

  const creditTransaction = await prisma.creditTransaction.create({
    data: {
      amount: convertCreditsToBaseUnits(1000.5123),
      type: CreditTransactionType.TOP_UP,
      userId: user.id,
      includedFee: 0,
      status: CreditTransactionStatus.SUCCEEDED,
    },
  });
  console.log(`Credit transaction created with id ${creditTransaction.id}`);
  return user.id;
};

const seedCreditCost = async () => {
  console.log("Seeding credit cost...");
  await prisma.creditCost.upsert({
    where: {
      unit: "usdm",
    },
    update: {
      creditCostPerUnit: 1_000_000, // 1 base unit usdm == 0.000001 usdm == 1_000_000 credits
    },
    create: {
      unit: "usdm",
      creditCostPerUnit: 1_000_000, // 1 base unit usdm == 0.000001 usdm == 1_000_000 credits
    },
  });
  console.log("USDM credit cost seeded");

  await prisma.creditCost.upsert({
    where: {
      unit: "",
    },
    update: {
      creditCostPerUnit: 500_000, // 1 lovelace == 500_000 credits
    },
    create: {
      unit: "",
      creditCostPerUnit: 500_000, // 1 lovelace == 500_000 credits
    },
  });
  console.log("Lovelace credit cost seeded");
};

async function main() {
  if (seedDatabase) {
    await seedUser();
  }
  await seedCreditCost();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
