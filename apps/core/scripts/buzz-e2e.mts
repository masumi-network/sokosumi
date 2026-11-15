/**
 * Live end-to-end checks of the Buzz bridge against a running Core, relay and
 * bridge (scripts/buzz-local/README.md). Acts as the seeded fixture people:
 * Alice through Sokosumi, Bob from Buzz with the key Sokosumi keeps for him,
 * and Admin from a throwaway "own Buzz app" key linked for the run.
 *
 *   pnpm --filter @sokosumi/core buzz:e2e [--core-url http://localhost:3021] [--only A,B]
 *
 * Exits non-zero when a check fails. Leaves the room's messages behind (each
 * names its run) and unlinks the throwaway app key.
 */
import { createHash, randomUUID } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { BUZZ_KIND } from "@/lib/buzz/events";
import {
  publishSignedEvent,
  queryEvents,
  relayHttpOrigin,
  signEvent,
} from "@/lib/buzz/relay-client";
import prisma from "@/lib/db/prisma";
import {
  bridgeApiKeyFor,
  buzzConfig,
  ensureIdentity,
  identitySecretKey,
  linkBuzzApp,
  syncRoomChannel,
  unlinkBuzzApp,
} from "@/services/buzz-bridge.service";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const CORE = flag("core-url") ?? "http://localhost:3021";
const ONLY = flag("only")?.split(",");
const ORG = "alice-fixture";
const RUN = randomUUID().slice(0, 8);

const maybeConfig = buzzConfig();
if (!maybeConfig) throw new Error("Buzz is not configured in this env");
const config = maybeConfig;

const people = Object.fromEntries(
  await Promise.all(
    (["alice", "bob", "admin"] as const).map(async (name) => {
      const user = await prisma.user.findFirstOrThrow({
        where: { email: `${name}@sokosumi.test` },
        select: { id: true },
      });
      return [name, await ensureIdentity({ userId: user.id })];
    }),
  ),
) as Record<
  "alice" | "bob" | "admin",
  Awaited<ReturnType<typeof ensureIdentity>>
>;

const room = await prisma.chatRoom.findFirstOrThrow({
  where: { name: "buzz-test", organization: { slug: ORG } },
  select: { id: true, buzzChannel: { include: { community: true } } },
});
if (!room.buzzChannel) throw new Error("buzz-test is not on Buzz yet");
const channelId = room.buzzChannel.channelId;
const relayUrl = room.buzzChannel.community.relayUrl;

async function api(
  who: keyof typeof people,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await fetch(new URL(path, CORE), {
    method,
    headers: {
      // Read afresh: linking an app key replaces the person's bridge key.
      authorization: `Bearer ${await bridgeApiKeyFor(
        await prisma.buzzIdentity.findUniqueOrThrow({
          where: { id: people[who].id },
        }),
      )}`,
      "x-organization-slug": ORG,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${method} ${path} → ${response.status} ${text.slice(0, 200)}`,
    );
  return text
    ? (JSON.parse(text) as { data: Record<string, unknown> }).data
    : {};
}

/** Events in the room's channel (a private channel is read by `#h`). */
function relay(filter: Parameters<typeof queryEvents>[0]["filters"][number]) {
  return queryEvents({
    relayUrl,
    secretKey: config.operatorSecretKey,
    filters: [{ "#h": [channelId], ...filter }],
  });
}

async function fromBuzz(
  secretKey: Uint8Array,
  draft: { kind: number; tags: string[][]; content: string },
) {
  const event = signEvent(draft, secretKey);
  await publishSignedEvent({ relayUrl, event, secretKey });
  return event;
}

async function waitFor<T>(
  what: string,
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 90_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    // A relay or database that is briefly away is not an answer yet.
    const value = await check().catch((error: unknown) => {
      lastError = error;
      return null;
    });
    if (value) return value;
    if (Date.now() > until)
      throw new Error(
        `timed out waiting for ${what}${lastError instanceof Error ? ` (last error: ${lastError.message})` : ""}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

// Relays filter on single-letter tags only, so the message's own tag is
// matched here.
const messageEvent = async (messageId: string) =>
  (await relay({ kinds: [9], limit: 100 })).find((event) =>
    event.tags.some((tag) => tag[0] === "sokosumi" && tag[1] === messageId),
  );

type Check = { id: string; name: string; run: () => Promise<void> };
const checks: Check[] = [];
const check = (id: string, name: string, run: () => Promise<void>) =>
  checks.push({ id, name, run });

let aliceMessage = "";
let aliceEventId = "";
check("A", "a message written in Sokosumi reaches Buzz", async () => {
  const message = await api(
    "alice",
    "POST",
    `/v1/chats/rooms/${room.id}/messages`,
    {
      content: `e2e ${RUN} A: hello from Sokosumi`,
    },
  );
  aliceMessage = message.id as string;
  const event = await waitFor("the kind 9", () => messageEvent(aliceMessage));
  aliceEventId = event.id;
});

check("B", "an edit in Sokosumi reaches Buzz", async () => {
  await api(
    "alice",
    "PATCH",
    `/v1/chats/rooms/${room.id}/messages/${aliceMessage}`,
    {
      content: `e2e ${RUN} A: hello from Sokosumi (edited)`,
    },
  );
  // An edit made before the message went out travels with it.
  await waitFor("the edit on Buzz", async () =>
    (await relay({ kinds: [9, 40003], limit: 50 })).find(
      (e) =>
        e.content.endsWith("(edited)") &&
        (e.id === aliceEventId ||
          e.tags.some((t) => t[0] === "e" && t[1] === aliceEventId)),
    ),
  );
});

check("C", "a reaction in Sokosumi reaches Buzz", async () => {
  await api(
    "bob",
    "PUT",
    `/v1/chats/rooms/${room.id}/messages/${aliceMessage}/reactions/${encodeURIComponent("👍")}`,
  );
  await waitFor("Bob's kind 7", async () =>
    (await relay({ kinds: [7], "#e": [aliceEventId] })).find(
      (e) => e.pubkey === people.bob.pubkey && e.content === "👍",
    ),
  );
});

let bobEventId = "";
let bobMessage = "";
check("D", "a message written in Buzz reaches Sokosumi", async () => {
  const event = await fromBuzz(identitySecretKey(people.bob), {
    kind: BUZZ_KIND.message,
    tags: [["h", channelId]],
    content: `e2e ${RUN} D: hello from Buzz`,
  });
  bobEventId = event.id;
  const message = await waitFor("Bob's message in Sokosumi", () =>
    prisma.chatRoomMessage.findFirst({
      where: { roomId: room.id, clientMessageId: `buzz:${event.id}` },
    }),
  );
  bobMessage = message.id;
  if (message.senderUserId !== people.bob.userId)
    throw new Error("posted as the wrong person");
});

check("E", "a thread reply written in Buzz lands in the thread", async () => {
  const event = await fromBuzz(identitySecretKey(people.bob), {
    kind: BUZZ_KIND.message,
    tags: [
      ["h", channelId],
      ["e", aliceEventId, "", "reply"],
    ],
    content: `e2e ${RUN} E: reply from Buzz`,
  });
  const reply = await waitFor("the reply", () =>
    prisma.chatRoomMessage.findFirst({
      where: { clientMessageId: `buzz:${event.id}` },
    }),
  );
  if (reply.parentMessageId !== aliceMessage)
    throw new Error("the reply is not in Alice's thread");
});

check(
  "F",
  "an edit, a reaction and a deletion in Buzz reach Sokosumi",
  async () => {
    const key = identitySecretKey(people.bob);
    await fromBuzz(key, {
      kind: BUZZ_KIND.edit,
      tags: [
        ["h", channelId],
        ["e", bobEventId],
      ],
      content: `e2e ${RUN} D: hello from Buzz (edited)`,
    });
    await waitFor("the edit", async () =>
      (
        await prisma.chatRoomMessage.findUnique({ where: { id: bobMessage } })
      )?.content.endsWith("(edited)"),
    );
    await fromBuzz(key, {
      kind: BUZZ_KIND.reaction,
      tags: [
        ["h", channelId],
        ["e", aliceEventId],
        ["p", people.alice.pubkey],
      ],
      content: "🎉",
    });
    await waitFor("the reaction", () =>
      prisma.chatRoomReaction.findFirst({
        where: {
          messageId: aliceMessage,
          userId: people.bob.userId ?? "",
          emoji: "🎉",
        },
      }),
    );
    await fromBuzz(key, {
      kind: BUZZ_KIND.deletion,
      tags: [
        ["h", channelId],
        ["e", bobEventId],
      ],
      content: "",
    });
    await waitFor(
      "the deletion",
      async () =>
        (await prisma.chatRoomMessage.findUnique({ where: { id: bobMessage } }))
          ?.deletedAt,
    );
  },
);

check("G", "a deletion in Sokosumi reaches Buzz", async () => {
  await api(
    "alice",
    "DELETE",
    `/v1/chats/rooms/${room.id}/messages/${aliceMessage}`,
  );
  await waitFor(
    "the kind 5",
    async () => (await relay({ kinds: [5], "#e": [aliceEventId] })).length > 0,
  );
});

check(
  "H",
  "a message from a person's own Buzz app: theirs in Sokosumi, taken down on Buzz when deleted there",
  async () => {
    const admin = people.admin;
    const appKey = generateSecretKey();
    const appPubkey = getPublicKey(appKey);
    const proof = JSON.stringify([
      "auth",
      appPubkey,
      "",
      bytesToHex(
        schnorr.sign(
          sha256(utf8ToBytes(`nostr:agent-auth:${admin.pubkey}:`)),
          appKey,
        ),
      ),
    ]);
    if (!admin.userId) throw new Error("admin has no user");
    await linkBuzzApp(admin.userId, proof);
    try {
      // The app key joins the room's channel with the next sync.
      await syncRoomChannel(room.id);
      const event = await fromBuzz(appKey, {
        kind: BUZZ_KIND.message,
        tags: [["h", channelId]],
        content: `e2e ${RUN} H: written in my own Buzz app`,
      });
      const message = await waitFor("the app's message in Sokosumi", () =>
        prisma.chatRoomMessage.findFirst({
          where: { clientMessageId: `buzz:${event.id}` },
          include: { buzzLink: true },
        }),
      );
      if (message.senderUserId !== admin.userId)
        throw new Error("not posted as its owner");
      if (message.buzzLink?.signerPubkey !== appPubkey)
        throw new Error("not recorded as written by the app key");
      await api(
        "admin",
        "DELETE",
        `/v1/chats/rooms/${room.id}/messages/${message.id}`,
      );
      await waitFor(
        "the admin deletion (kind 9005)",
        async () =>
          (await relay({ kinds: [BUZZ_KIND.adminDelete], "#e": [event.id] }))
            .length > 0,
      );
      await waitFor(
        "the message gone from Buzz",
        async () => (await relay({ ids: [event.id] })).length === 0,
      );
    } finally {
      await unlinkBuzzApp(admin.userId);
      await syncRoomChannel(room.id);
    }
  },
);

check("I", "a Direct deleted in Sokosumi is deleted on Buzz", async () => {
  const direct = await api("alice", "POST", "/v1/chats/rooms", {
    kind: "direct",
    memberUserIds: [people.bob.userId],
  });
  const directId = direct.id as string;
  await api("alice", "POST", `/v1/chats/rooms/${directId}/messages`, {
    content: `e2e ${RUN} I: a Direct`,
  });
  const dm = await waitFor("the DM on Buzz", () =>
    prisma.buzzChannel.findUnique({ where: { roomId: directId } }),
  );
  // As account deletion or an organization's retirement removes it.
  await prisma.chatRoom.delete({ where: { id: directId } });
  await waitFor(
    "the DM deleted on Buzz",
    async () => {
      const events = await queryEvents({
        relayUrl,
        secretKey: identitySecretKey(people.alice),
        filters: [{ kinds: [9], "#h": [dm.channelId], limit: 1 }],
      }).catch(() => []);
      const link = await prisma.buzzChannel.findUnique({
        where: { id: dm.id },
      });
      return events.length === 0 && !link;
    },
    120_000,
  );
});

check(
  "M",
  "a file attached in Buzz is copied into Sokosumi's chat files",
  async () => {
    // A 1x1 PNG: the relay keeps only media types it recognizes.
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const sha = createHash("sha256").update(bytes).digest("hex");
    const key = identitySecretKey(people.bob);
    const host = new URL(relayUrl).host;
    const upload = `${relayHttpOrigin(relayUrl)}/media/upload`;
    const auth = signEvent(
      {
        kind: 24242,
        content: "Upload blob",
        tags: [
          ["t", "upload"],
          ["x", sha],
          ["server", host],
          ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
        ],
      },
      key,
    );
    const response = await fetch(upload, {
      method: "PUT",
      headers: {
        authorization: `Nostr ${Buffer.from(JSON.stringify(auth)).toString("base64")}`,
        "content-type": "image/png",
        "x-sha-256": sha,
      },
      body: bytes,
    });
    if (!response.ok)
      throw new Error(
        `upload refused: ${response.status} ${await response.text()}`,
      );
    const { url } = (await response.json()) as { url: string };
    const event = await fromBuzz(key, {
      kind: BUZZ_KIND.message,
      tags: [
        ["h", channelId],
        [
          "imeta",
          `url ${url}`,
          "m image/png",
          `x ${sha}`,
          `size ${bytes.length}`,
        ],
      ],
      content: `e2e ${RUN} M: see ${url}`,
    });
    const message = await waitFor("the message in Sokosumi", () =>
      prisma.chatRoomMessage.findFirst({
        where: { clientMessageId: `buzz:${event.id}` },
      }),
    );
    if (message.content.includes(url))
      throw new Error(`still points at the relay: ${message.content}`);
    const copy = message.content.match(/https:\/\/\S+/)?.[0] ?? "";
    const fetched = await fetch(copy);
    if (!fetched.ok || !Buffer.from(await fetched.arrayBuffer()).equals(bytes))
      throw new Error(`the copy ${copy} is not the file`);
  },
);

check(
  "S",
  "soak: every message, both ways, arrives exactly once across lease hand-overs (5 min, --soak)",
  async () => {
    const sent: { fromBuzz: boolean; text: string }[] = [];
    const until = Date.now() + 5 * 60_000;
    for (let n = 0; Date.now() < until; n++) {
      const text = `e2e ${RUN} S${n}`;
      await api("alice", "POST", `/v1/chats/rooms/${room.id}/messages`, {
        content: `${text} from Sokosumi`,
      });
      await fromBuzz(identitySecretKey(people.bob), {
        kind: BUZZ_KIND.message,
        tags: [["h", channelId]],
        content: `${text} from Buzz`,
      });
      sent.push({ fromBuzz: false, text: `${text} from Sokosumi` });
      sent.push({ fromBuzz: true, text: `${text} from Buzz` });
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    await waitFor(
      "every message on both sides, once",
      async () => {
        const onBuzz = await relay({ kinds: [9], limit: 500 });
        const inSokosumi = await prisma.chatRoomMessage.findMany({
          where: { roomId: room.id, content: { startsWith: `e2e ${RUN} S` } },
          select: { content: true },
        });
        return sent.every(
          ({ text }) =>
            onBuzz.filter((e) => e.content === text).length === 1 &&
            inSokosumi.filter((m) => m.content === text).length === 1,
        );
      },
      120_000,
    );
  },
);

let failed = 0;
for (const { id, name, run } of checks) {
  if (ONLY ? !ONLY.includes(id) : id === "S" && !args.includes("--soak"))
    continue;
  const started = Date.now();
  try {
    await run();
    console.log(
      `✓ ${id} ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  } catch (error) {
    failed++;
    console.log(
      `✗ ${id} ${name}: ${error instanceof Error ? error.message : error}`,
    );
  }
}
console.log(
  failed
    ? `${failed} check(s) failed (run ${RUN})`
    : `all checks passed (run ${RUN})`,
);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
