import { jobStatusToAgentJobStatus } from "@/lib/db/job/utils";
import { PrismaClient } from "@/prisma/generated/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    const jobs = await tx.job.findMany();
    for (const job of jobs) {
      const output = job.output;
      if (output) {
        const outputJson = JSON.parse(output);
        const agentJobStatus = jobStatusToAgentJobStatus(outputJson.status);
        await tx.job.update({
          where: { id: job.id },
          data: {
            agentJobStatus: agentJobStatus,
          },
        });
      }
    }
  });
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
