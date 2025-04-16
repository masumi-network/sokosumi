import { v4 as uuidv4 } from "uuid";

import { getEnvSecrets } from "@/config/env.config";
import { convertCreditsToCents } from "@/lib/db";
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

  const creditTransaction = await prisma.creditTransaction.create({
    data: {
      amount: convertCreditsToCents(1000.5123),
      userId: user.id,
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
      centsPerUnit: 1_000_000, // 1 base unit usdm == 0.000001 usdm == 1_000_000 credits
    },
    create: {
      unit: "usdm",
      centsPerUnit: 1_000_000, // 1 base unit usdm == 0.000001 usdm == 1_000_000 credits
    },
  });
  console.log("USDM credit cost seeded");

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
