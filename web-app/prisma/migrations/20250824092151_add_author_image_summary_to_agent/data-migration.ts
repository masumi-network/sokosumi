import { anthropicClient } from "@/lib/clients";
import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  // Use raw SQL to add summary to the agent if summary is not set.
  const agents = await prisma.agent.findMany({
    where: {
      summary: null,
    },
  });

  for (const agent of agents) {
    if (agent.description) {
      const summary = await anthropicClient.generateAgentSummary(
        agent.description,
      );
      await prisma.$executeRaw`
        UPDATE "agent" a
        SET "summary" = ${summary}
        WHERE "id" = ${agent.id};
      `;
    }
  }

  console.log(`Updated ${agents.length} agents`);
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
