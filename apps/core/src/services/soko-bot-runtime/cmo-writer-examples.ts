import { z } from "zod";
import prisma from "@/lib/db/prisma";
import { type EmbedTexts } from "@/lib/embeddings";
import { similarities } from "@/lib/repeats";

/**
 * cmo-v23-openings: the posts that did best for the business on each network
 * (its connected accounts' synced posts) and for its competitors (the
 * weekly check's top Instagram posts), so a chunk writes from real posts
 * that worked rather than from rules alone.
 */
export interface CmoWriterExample {
  channel: string;
  text: string;
  engagement: number;
  /** "own" or the competitor's name. */
  from: string;
}

const OWN_DAYS = 365;
const COMPETITOR_DAYS = 60;
const MIN_TEXT_CHARS = 40;
const EXAMPLE_CHARS = 600;
/** Best posts per network kept before the chunk picks its closest. */
const POOL = 12;
/** Examples one chunk reads. */
export const EXAMPLES_PER_CHUNK = 4;

const metricsSchema = z
  .object({
    likes: z.number().nullish(),
    comments: z.number().nullish(),
    shares: z.number().nullish(),
    saves: z.number().nullish(),
  })
  .passthrough();

function engagementOf(metrics: unknown): number {
  const parsed = metricsSchema.safeParse(metrics);
  if (!parsed.success) return 0;
  const { likes, comments, shares, saves } = parsed.data;
  return (likes ?? 0) + 2 * (comments ?? 0) + 2 * (shares ?? 0) + (saves ?? 0);
}

function channelOf(provider: string): string {
  const name = provider.toLowerCase();
  return name === "twitter" ? "x" : name;
}

const topPostsSchema = z.object({
  topPosts: z
    .array(
      z.object({
        caption: z.string().nullable(),
        likes: z.number().nullable(),
        comments: z.number().nullable(),
      }),
    )
    .catch([]),
});

/** Every network's best posts, the best first, at most POOL each. */
export function cmoBestExamples(
  examples: readonly CmoWriterExample[],
): Map<string, CmoWriterExample[]> {
  const byChannel = new Map<string, CmoWriterExample[]>();
  const seen = new Set<string>();
  for (const example of [...examples].sort(
    (a, b) => b.engagement - a.engagement,
  )) {
    const text = example.text.trim();
    const key = text.toLowerCase();
    if (example.engagement <= 0 || text.length < MIN_TEXT_CHARS) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byChannel.get(example.channel) ?? [];
    if (list.length < POOL)
      byChannel.set(example.channel, [
        ...list,
        { ...example, text: text.slice(0, EXAMPLE_CHARS) },
      ]);
  }
  return byChannel;
}

/** The business's and its competitors' best posts, by network. */
export async function readCmoWriterExamples(
  projectId: string,
  now: Date,
): Promise<Map<string, CmoWriterExample[]>> {
  const [own, signals] = await Promise.all([
    prisma.socialAccountPost.findMany({
      where: {
        connection: { projectId },
        publishedAt: { gte: new Date(now.getTime() - OWN_DAYS * 86_400_000) },
      },
      orderBy: { publishedAt: "desc" },
      take: 500,
      select: {
        text: true,
        metrics: true,
        connection: { select: { provider: true } },
      },
    }),
    prisma.competitorSignal.findMany({
      where: {
        projectId,
        kind: "SOCIAL",
        observedAt: {
          gte: new Date(now.getTime() - COMPETITOR_DAYS * 86_400_000),
        },
      },
      select: { raw: true, competitor: { select: { name: true } } },
    }),
  ]);
  return cmoBestExamples([
    ...own.map((post) => ({
      channel: channelOf(post.connection.provider),
      text: post.text,
      engagement: engagementOf(post.metrics),
      from: "own",
    })),
    ...signals.flatMap(
      (signal) =>
        topPostsSchema.safeParse(signal.raw).data?.topPosts.flatMap((post) =>
          post.caption
            ? [
                {
                  channel: "instagram",
                  text: post.caption,
                  engagement: (post.likes ?? 0) + 2 * (post.comments ?? 0),
                  from: signal.competitor.name,
                },
              ]
            : [],
        ) ?? [],
    ),
  ]);
}

/**
 * The examples closest by meaning to what a chunk writes about, or the best
 * ones when the embedding model does not answer.
 */
export async function cmoClosestExamples(
  pool: readonly CmoWriterExample[],
  about: string,
  embed?: EmbedTexts,
): Promise<{ examples: CmoWriterExample[]; costUsd: number }> {
  if (pool.length <= EXAMPLES_PER_CHUNK)
    return { examples: [...pool], costUsd: 0 };
  const { scores, costUsd } = await similarities(
    about,
    pool.map((example) => example.text),
    embed,
  ).catch(() => ({ scores: null, costUsd: 0 }));
  if (!scores) return { examples: pool.slice(0, EXAMPLES_PER_CHUNK), costUsd };
  const ranked = pool
    .map((example, index) => ({ example, score: scores[index] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, EXAMPLES_PER_CHUNK)
    .map(({ example }) => example);
  return { examples: ranked, costUsd };
}

/** The chunk's lines on its examples. */
export function cmoExamplesLines(
  examples: readonly CmoWriterExample[],
): string {
  if (examples.length === 0) return "";
  return [
    "Posts that did well on this network, the business's own and its competitors' (likes and comments in brackets). Learn how they open, how long they run and how they sound. Never copy their words, and never take a fact, number or name from a competitor's post:",
    ...examples.map(
      (example) =>
        `- [${example.from === "own" ? "ours" : example.from}, ${example.engagement}] ${example.text.replace(/\s+/g, " ")}`,
    ),
  ].join("\n");
}
