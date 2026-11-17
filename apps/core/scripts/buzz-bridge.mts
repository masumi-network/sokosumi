/**
 * Buzz bridge worker: keeps organizations' chats and their Buzz communities in
 * step, in both directions. Long-running, so it lives outside the serverless
 * Core; it needs Core's database and a running Core to post through.
 *
 *   pnpm --filter @sokosumi/core buzz:bridge enable --org <id or slug>
 *   pnpm --filter @sokosumi/core buzz:bridge run [--core-url http://localhost:3001]
 *   pnpm --filter @sokosumi/core buzz:bridge status
 */
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { enableBuzzForOrganization } from "@/services/buzz-bridge.service";
import {
  coreRequester,
  runLeasedBuzzBridge,
} from "@/services/buzz-bridge-runner";

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

function log(message: string, extra?: unknown) {
  const line = `[buzz-bridge ${new Date().toISOString()}] ${message}`;
  if (extra === undefined) console.log(line);
  else console.log(line, extra);
}

async function enable() {
  const org = flag("org");
  if (!org) throw new Error("--org <id or slug> is required");
  const organization = await prisma.organization.findFirstOrThrow({
    where: { OR: [{ id: org }, { slug: org }] },
    select: { id: true, name: true },
  });
  const community = await enableBuzzForOrganization(organization.id);
  log(`${organization.name} is on Buzz at ${community.relayUrl}`);
}

async function status() {
  const communities = await prisma.buzzCommunity.findMany({
    select: {
      relayUrl: true,
      organization: { select: { name: true } },
      _count: { select: { channels: true, members: true } },
    },
  });
  const [messages, reactions, outbox] = await Promise.all([
    prisma.buzzMessageLink.count(),
    prisma.buzzReactionLink.count(),
    prisma.buzzOutbox.count(),
  ]);
  console.table(
    communities.map((c) => ({
      organization: c.organization?.name ?? "(deleted)",
      relay: c.relayUrl,
      channels: c._count.channels,
      members: c._count.members,
    })),
  );
  log(`${messages} messages, ${reactions} reactions linked; outbox ${outbox}`);
}

/** Runs the bridge until stopped, in leased turns like `/sync/buzz`. */
async function run() {
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const core = coreRequester(
    flag("core-url") ?? `http://localhost:${getEnv().PORT}`,
  );
  // Leased like `/sync/buzz`, so a second worker waits instead of doubling
  // every change; each turn hands over to the next.
  while (!stopping) {
    const ran = await runLeasedBuzzBridge({
      core,
      log,
      until: Date.now() + 10 * 60_000,
      waitMs: 60_000,
      shouldContinue: () => !stopping,
    });
    if (!ran && !stopping) log("another worker holds the lease; waiting");
  }
}

try {
  if (command === "enable") await enable();
  else if (command === "status") await status();
  else if (command === "run") await run();
  else {
    console.log("usage: buzz:bridge enable --org <id|slug> | run | status");
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
