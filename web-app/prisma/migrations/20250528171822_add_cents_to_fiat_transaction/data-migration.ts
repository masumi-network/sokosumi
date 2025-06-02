import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  // find all fiat transactions without cents
  const fiatTransactions = await prisma.fiatTransaction.findMany({
    where: {
      cents: 0,
    },
  });
  console.log(
    `Found ${fiatTransactions.length} fiat transactions without cents`,
  );

  for (const fiatTransaction of fiatTransactions) {
    await prisma.$transaction(async (tx) => {
      const { centsPerAmount, amount } = fiatTransaction;
      const cents = (centsPerAmount ?? BigInt(0)) * BigInt(amount);
      await tx.fiatTransaction.update({
        where: { id: fiatTransaction.id },
        data: { cents },
      });
    });
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
