import {
  type BrandBrain,
  CMO_PICKED_PIECE_WRITING_GUIDE,
  CMO_PIECE_WRITING_GUIDE,
  CMO_PRODUCTION_TURN_PREFIX,
  CMO_SCENE_PIECE_WRITING_GUIDE,
  CMO_VARIED_PIECE_WRITING_GUIDE,
  type CmoCalendarEntry,
  getSokoBotVersion,
  type MarketingStrategyPlan,
  PICTURE_KINDS,
  type PictureKind,
  REFERENCE_PURPOSES,
  writingSkillsBrief,
} from "@sokosumi/soko-bot";
import { generateText, Output } from "ai";
import { z } from "zod";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import { sokoBotTurnPurpose } from "@/lib/ai-gateway-purpose";
import prisma from "@/lib/db/prisma";
import { EMBEDDING_MODEL } from "@/lib/embeddings";
import { gatewayCallUsage } from "@/lib/soko-bot/gateway-cost";
import { SOKO_BOT_JEV_MODEL } from "@/lib/soko-bot/jev";
import { modelCallTelemetryFor } from "@/lib/soko-bot/model-calls";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";
import { RuntimeEventLog, runtimeEvent } from "@/lib/soko-bot/turn-loop";
import {
  compactBrandBrain,
  getBrandBrain,
  parseBrandBrain,
} from "@/services/brand-brain.service";
import { listCmoBrandPictures } from "@/services/cmo-brand-media.service";
import {
  findCusoForBot,
  startCmoProduction,
} from "@/services/cmo-cuso.service";
import {
  type CmoKindedPiece,
  cmoAllowedKinds,
  cmoMakesVariedMonth,
  cmoNeighbourlyKind,
  cmoPicksPictures,
  cmoPieceIsTalking,
  cmoPieceNeedsMedia,
  cmoPieceTakesStyle,
  cmoWritesSceneVisuals,
  LAYOUT_KINDS,
} from "@/services/cmo-media-maker.service";
import { cmoDraftProblems } from "@/services/cmo-plan-review.service";
import {
  type CmoPiece,
  cmoConnectedChannels,
  cmoMixLedger,
  cmoPieceLine,
  cmoPraiseOnly,
  cmoProofPoints,
  cmoWriterPieces,
  readCmoProduction,
} from "@/services/cmo-production.service";
import {
  findStyleReferences,
  infographicSuits,
  referenceLibraryAvailable,
} from "@/services/reference-library.service";
import { getSocialPost } from "@/services/social-posts.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { chargeCheck } from "./cmo";
import { type RuntimeOperations } from "./operations";

/**
 * Core's month writer (cmo-v6): one structured call per chunk of pieces,
 * the chunks at once, every result saved through the same tools Cuso's own
 * saves go through, so each piece passes the same checks and leaves the same
 * receipts. A call must answer within the runner's two minutes, so it takes
 * at most PIECES_PER_CALL pieces and stops saving at SAVE_DEADLINE_MS; what
 * it did not save stays pending for the next call.
 */
const PIECES_PER_CALL = 40;
const PIECES_PER_CHUNK = 10;
const MODEL_TIMEOUT_MS = 75_000;
const SAVE_DEADLINE_MS = 100_000;
/** A repair round starts only while a chunk call and its saves still fit. */
const REPAIR_START_MS = 60_000;

const writtenPieceSchema = z.object({
  id: z.string(),
  /**
   * Named before the words: NMKR's X posts written without it missed "names
   * one thing only this business has" 8 times in 20, with it twice.
   */
  onlyUs: z.string().nullable(),
  draft: z.string().nullable(),
  firstComment: z.string().nullable(),
  visual: z.string().nullable(),
  visualFileIds: z.array(z.string()).nullable(),
  slides: z.array(z.string()).nullable(),
  styleLook: z.string().nullable(),
  /** The kind of picture a cmo-v11 picture is drawn as. */
  pictureKind: z.enum(PICTURE_KINDS).nullable(),
  /** What the picture is for: only data and comparison take an infographic (cmo-v8). */
  purpose: z.enum(REFERENCE_PURPOSES).nullable(),
  headline: z.string().nullable(),
  slideHeadlines: z.array(z.string()).nullable(),
  script: z.string().nullable(),
  presenter: z.string().nullable(),
  voice: z.string().nullable(),
  /** A talking video's language as a two-letter code. */
  languageCode: z.string().nullable(),
});
const writtenChunkSchema = z.object({ pieces: z.array(writtenPieceSchema) });
type WrittenPiece = z.infer<typeof writtenPieceSchema>;

/** A piece Core could not save, with the reason its check gave. */
export interface CmoRefusedPiece {
  id: string;
  title: string;
  reason: string;
}

/** Pieces in chunks of one network, in date order, so a chunk reads as a run. */
export function cmoWriterChunks(
  pieces: readonly CmoPiece[],
  size = PIECES_PER_CHUNK,
): CmoPiece[][] {
  const byChannel = new Map<string, CmoPiece[]>();
  for (const piece of [...pieces].sort((a, b) =>
    `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`),
  ))
    byChannel.set(piece.channel, [
      ...(byChannel.get(piece.channel) ?? []),
      piece,
    ]);
  return [...byChannel.values()].flatMap((list) =>
    Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
      list.slice(index * size, (index + 1) * size),
    ),
  );
}

/**
 * The brief every chunk shares, word for word, so the provider reads it
 * from its prompt cache after the first call: how pieces are written, the
 * writing skills of the month's networks, the brand, the strategy and every
 * title of the month.
 */
export function cmoWriterSystem(input: {
  businessName: string;
  strategy: MarketingStrategyPlan;
  brain: BrandBrain | null;
  proof: readonly string[];
  brandPictures: readonly { fileId: string; alt: string }[];
  styles: boolean;
  /** cmo-v8: varied picture kinds, a claim per piece, LinkedIn openings. */
  varied?: boolean;
  /** cmo-v9: a styled picture's visual is a scene alone. */
  scenes?: boolean;
  /** cmo-v11: pictures borrow a print's layout, in a varied picture kind. */
  picked?: boolean;
}): string {
  const { strategy } = input;
  const live = strategy.calendar.filter((entry) => entry.status !== "skipped");
  return [
    `You are Cuso, the CMO of ${input.businessName}. You write pieces of its approved month. Core checks and saves each piece you return, makes its picture or video and schedules it.`,
    input.picked
      ? CMO_PICKED_PIECE_WRITING_GUIDE
      : input.scenes
        ? CMO_SCENE_PIECE_WRITING_GUIDE
        : input.varied
          ? CMO_VARIED_PIECE_WRITING_GUIDE
          : CMO_PIECE_WRITING_GUIDE,
    input.styles && input.picked
      ? "Pictures here borrow an old print's layout and are drawn in the brand's own look: give every piece with a picture a styleLook (the composition), a pictureKind, and a headline or slideHeadlines. Leave pictureKind null for any other piece."
      : input.styles
        ? "Pictures here take an old print's style: give every piece with a picture a styleLook, and a headline or slideHeadlines."
        : "Pictures here are made from the brand's own pictures: leave styleLook, headline and slideHeadlines null.",
    writingSkillsBrief(live.map((entry) => entry.channel)),
    "Brand Brain:",
    JSON.stringify(compactBrandBrain(input.brain)),
    input.proof.length > 0
      ? [
          "Proof you may name, from the Brand Brain, word for word (customers, results, reviews; each in at most two pieces of the month). A piece built on one of them is better than advice any business could give:",
          ...input.proof.map((point) => `- ${point}`),
        ].join("\n")
      : "",
    "Brand pictures (fileId: what it shows):",
    ...input.brandPictures.map(
      (picture) => `- ${picture.fileId}: ${picture.alt}`,
    ),
    "Strategy:",
    JSON.stringify({
      summary: strategy.summary,
      idea: strategy.idea,
      offer: strategy.offer,
      pillars: strategy.pillars,
      campaigns: strategy.campaigns,
      contentLanguage: strategy.contentLanguage,
    }),
    `The mix, as planned: ${cmoMixLedger(strategy)}. Each piece keeps its approach.`,
    "Every piece of the month, so no two say the same thing:",
    ...live.map(
      (entry) =>
        `- ${entry.date} ${entry.channel}/${entry.format} · ${entry.pillar ?? ""} · ${entry.title}${entry.claim ? ` · claim: ${entry.claim}` : ""}`,
    ),
  ]
    .filter((line) => line !== "")
    .join("\n\n");
}

/**
 * Each chunk's share of the Brand Brain's named proof. Chunks are written at
 * once and cannot see each other, so given all of it every chunk named the
 * same two customers, and Core refused the repeats as one message.
 */
export function cmoChunkProof(
  proof: readonly string[],
  chunk: number,
  chunks: number,
): string[] {
  if (proof.length === 0 || chunks <= 0) return [];
  const mine = proof.filter((_, index) => index % chunks === chunk);
  return mine.length > 0 ? mine : [proof[chunk % proof.length]!];
}

function chunkPrompt(
  chunk: readonly CmoPiece[],
  failedMedia: ReadonlySet<string>,
  refused: ReadonlyMap<string, { draft: string | null; reason: string }>,
  lead: readonly string[],
  said: readonly string[],
): string {
  return [
    lead.length > 0
      ? [
          "Lead with this proof in these pieces, so the month spreads its customers and results (any other proof in your brief may follow):",
          ...lead.map((point) => `- ${point}`),
        ].join("\n")
      : "",
    said.length > 0
      ? [
          "Already written this month, by their first lines: give these pieces other openings and other messages.",
          ...said.map((line) => `- ${line}`),
        ].join("\n")
      : "",
    `Write these ${chunk.length} pieces now and return each by its id:`,
    ...chunk.map((piece) => {
      const again = refused.get(piece.id);
      return [
        cmoPieceLine(piece, failedMedia.has(piece.id)),
        piece.draft?.trim() && !again ? `(its words: ${piece.draft})` : "",
        again
          ? `(Core refused your last version: ${again.reason} Write it again so it passes.${again.draft ? ` Last version: ${again.draft}` : ""})`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    }),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Most first lines of written pieces a chunk is shown. */
const SAID_LINES = 150;

/** Each written piece's first line, so a chunk says something else. */
export function cmoSaidLines(calendar: readonly CmoCalendarEntry[]): string[] {
  return calendar
    .flatMap((entry) => {
      const line = entry.draft?.trim().split("\n")[0]?.trim();
      return line ? [line.length > 90 ? `${line.slice(0, 87)}...` : line] : [];
    })
    .slice(-SAID_LINES);
}

async function writeChunk(
  input: ExecuteSokoBotToolInput,
  request: ReturnType<typeof sokoBotModelRequest>,
  modelId: string,
  system: string,
  prompt: string,
): Promise<WrittenPiece[]> {
  const result = await generateText({
    ...request,
    system,
    prompt,
    output: Output.object({ schema: writtenChunkSchema }),
    maxOutputTokens: 16_000,
    abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    telemetry: modelCallTelemetryFor("cmo-month-writer"),
  }).catch(rethrowAiGatewayFailure);
  // Charged to the turn like its own steps, with its tokens.
  const usage = gatewayCallUsage(result);
  await new RuntimeEventLog(input.turnId, input.sessionId).append(
    runtimeEvent("step.completed", { modelId, usage }),
  );
  return writtenChunkSchema.parse(result.output).pieces;
}

/**
 * The batch piece a month-check problem is about: a problem about one piece
 * starts with its id; one about a phrase in several pieces lists them, and
 * the latest of those is rewritten.
 */
export function cmoProblemPiece(
  problem: string,
  ids: ReadonlySet<string>,
): string | null {
  const named = [...problem.matchAll(/[0-9a-z][\w-]{0,63}/gi)]
    .map((match) => match[0])
    .filter((id) => ids.has(id));
  if (named.length === 0) return null;
  return problem.startsWith(named[0]!) ? named[0]! : named.at(-1)!;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 400) : "refused";
}

/** The month's next pieces, written at once and saved through Cuso's own tools. */
export async function writeCmoMonthPieces(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<{
  written: number;
  refused: CmoRefusedPiece[];
  left: number;
  next: string;
}> {
  const startedAt = Date.now();
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select: { clientTurnId: true },
  });
  if (!turn?.clientTurnId?.startsWith(CMO_PRODUCTION_TURN_PREFIX))
    throw new SokoBotRuntimeValidationError(
      "write_month_pieces works in a production run only. Write a piece in chat yourself.",
    );
  const cuso = await findCusoForBot(authorized.turn.sokoBotId);
  if (!cuso) throw new SokoBotRuntimeValidationError("This bot is no Cuso.");
  const connected = await cmoConnectedChannels(cuso.projectId);
  const read = () =>
    readCmoProduction(cuso, { connected, subscribed: true, now: new Date() });
  const { strategy, pending, failedMedia } = await read();
  if (!strategy)
    throw new SokoBotRuntimeValidationError(
      "No strategy is approved: there is no month to write.",
    );
  const batch = cmoWriterPieces(pending).slice(0, PIECES_PER_CALL);
  if (batch.length === 0)
    return {
      written: 0,
      refused: [],
      left: 0,
      next: "Nothing is left for Core to write. Write the pieces your brief lists as yours, then report.",
    };

  const brain = parseBrandBrain((await getBrandBrain(cuso.projectId))?.body);
  const varied = cmoMakesVariedMonth(authorized.turn.versionId);
  const picksPictures = cmoPicksPictures(authorized.turn.versionId);
  const praise = varied
    ? await cmoPraiseOnly(cmoProofPoints(brain))
    : { points: cmoProofPoints(brain), costUsd: 0 };
  await chargeCheck(input, SOKO_BOT_JEV_MODEL, praise.costUsd);
  const proof = praise.points;
  const styles = referenceLibraryAvailable();
  const system = cmoWriterSystem({
    businessName: cuso.businessName,
    strategy,
    brain,
    proof,
    brandPictures: await listCmoBrandPictures(cuso.projectId),
    styles,
    varied,
    scenes: cmoWritesSceneVisuals(authorized.turn.versionId),
    picked: picksPictures,
  });
  const modelId = getSokoBotVersion(authorized.turn.versionId).model;
  const request = sokoBotModelRequest({
    role: "agent",
    model: modelId,
    purpose: sokoBotTurnPurpose({
      clientTurnId: turn.clientTurnId,
      versionId: authorized.turn.versionId,
    }),
  });
  const byId = new Map(batch.map((piece) => [piece.id, piece]));
  // Every style reference the month already uses: each piece gets its own.
  const usedStyles = new Set(
    strategy.calendar.flatMap((entry) => entry.styleReferenceId ?? []),
  );
  // cmo-v8: each styled piece's kind of print, so a pick keeps the kind rules.
  const kindOf = new Map(
    varied
      ? (
          await prisma.referenceImage.findMany({
            where: { id: { in: [...usedStyles] } },
            select: { id: true, kind: true },
          })
        ).map((row) => [row.id, row.kind])
      : [],
  );
  const kinded: CmoKindedPiece[] = strategy.calendar.flatMap((entry) => {
    const kind = entry.styleReferenceId
      ? kindOf.get(entry.styleReferenceId)
      : undefined;
    return kind
      ? [
          {
            id: entry.id,
            channel: entry.channel,
            date: entry.date,
            time: entry.time,
            kind,
          },
        ]
      : [];
  });
  // The picture kinds this call gave, beside those the calendar already holds.
  const pictureKinds = new Map<string, PictureKind>();
  const planned = strategy.calendar.filter(
    (entry) => entry.status !== "skipped" && cmoPieceTakesStyle(entry),
  ).length;
  let saveCall = 0;
  const child = (
    capability: "save_strategy" | "update_social_post",
    body: unknown,
  ) =>
    runtime.executeTool({
      ...input,
      capability,
      toolCallId: `${input.toolCallId}:${(saveCall += 1)}`,
      input: body,
    });

  const entryOf = async (
    piece: CmoPiece,
    written: WrittenPiece,
  ): Promise<CmoCalendarEntry | null> => {
    const talking = cmoPieceIsTalking(piece) && !piece.videoOf;
    if (talking)
      return written.script
        ? {
            ...pieceEntry(piece),
            script: written.script,
            ...(written.presenter ? { presenter: written.presenter } : {}),
            ...(written.voice ? { voice: written.voice } : {}),
            ...(/^[a-z]{2}$/.test(written.languageCode ?? "")
              ? { languageCode: written.languageCode as string }
              : {}),
          }
        : null;
    if (
      !cmoPieceNeedsMedia(piece) ||
      cmoPieceIsTalking(piece) ||
      !written.visual
    )
      return null;
    let styleReferenceId: string | undefined;
    if (styles && cmoPieceTakesStyle(piece)) {
      const purpose = varied ? (written.purpose ?? undefined) : undefined;
      const found = await findStyleReferences({
        about: written.styleLook || written.visual,
        limit: 8,
        exclude: [...usedStyles],
        ...(varied
          ? {
              purpose,
              kinds: cmoAllowedKinds({
                piece,
                month: kinded,
                infographicSuits: infographicSuits(purpose),
                planned,
              }).filter((kind) => !picksPictures || LAYOUT_KINDS.has(kind)),
            }
          : {}),
      });
      const picked = found.find((reference) => !usedStyles.has(reference.id));
      if (picked) {
        styleReferenceId = picked.id;
        usedStyles.add(picked.id);
        const at = kinded.findIndex((entry) => entry.id === piece.id);
        if (at !== -1) kinded.splice(at, 1);
        kinded.push({
          id: piece.id,
          channel: piece.channel,
          date: piece.date,
          time: piece.time,
          kind: picked.kind,
        });
      }
    }
    const pictureKind =
      picksPictures && styleReferenceId
        ? cmoNeighbourlyKind(
            written.pictureKind,
            piece,
            strategy.calendar,
            pictureKinds,
          )
        : undefined;
    if (pictureKind) pictureKinds.set(piece.id, pictureKind);
    return {
      ...pieceEntry(piece),
      visual: written.visual,
      visualFileIds: (written.visualFileIds ?? []).slice(0, 3),
      ...(pictureKind ? { pictureKind } : {}),
      ...(written.slides?.length
        ? { slides: written.slides.slice(0, 10) }
        : {}),
      ...(styleReferenceId ? { styleReferenceId } : {}),
      ...(styleReferenceId && written.headline
        ? { headline: written.headline.slice(0, 60) }
        : {}),
      ...(styleReferenceId && written.slideHeadlines?.length
        ? {
            slideHeadlines: written.slideHeadlines
              .slice(0, 10)
              .map((line) => line.slice(0, 60)),
          }
        : {}),
    };
  };

  /** Saves a chunk's results; returns what each piece's check refused. */
  const save = async (
    results: readonly WrittenPiece[],
  ): Promise<Map<string, { draft: string | null; reason: string }>> => {
    const refused = new Map<string, { draft: string | null; reason: string }>();
    const mine = results.filter((written) => byId.has(written.id));
    // One at a time, in date order: each pick sees the kind its neighbour took.
    const entries: CmoCalendarEntry[] = [];
    for (const written of mine) {
      const entry = await entryOf(byId.get(written.id)!, written);
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      // One save for the chunk; a refusal there is retried piece by piece,
      // so one piece's problem never holds back the rest.
      try {
        await child("save_strategy", {
          part: "pieces",
          strategy: { calendar: entries },
        });
      } catch {
        for (const entry of entries) {
          try {
            await child("save_strategy", {
              part: "pieces",
              strategy: { calendar: [entry] },
            });
          } catch (error) {
            refused.set(entry.id, { draft: null, reason: errorReason(error) });
          }
        }
      }
    }
    for (const written of mine) {
      if (Date.now() - startedAt > SAVE_DEADLINE_MS) break;
      const piece = byId.get(written.id)!;
      if (!written.draft?.trim() || piece.draft?.trim()) continue;
      try {
        const post = await getSocialPost({
          projectId: cuso.projectId,
          postId: piece.id,
          workspaceId: authorized.turn.workspaceId,
        });
        await child("update_social_post", {
          projectId: cuso.projectId,
          postId: piece.id,
          revision: post.revision,
          text: written.draft,
          ...(written.firstComment?.trim()
            ? { firstComment: written.firstComment }
            : {}),
        });
      } catch (error) {
        refused.set(piece.id, {
          draft: written.draft,
          reason: errorReason(error),
        });
      }
    }
    return refused;
  };

  const none = new Map<string, { draft: string | null; reason: string }>();
  const chunks = cmoWriterChunks(batch);
  const said = cmoSaidLines(strategy.calendar);
  const refused = new Map<string, { draft: string | null; reason: string }>();
  // Each chunk is saved as soon as it is written, one save at a time, so
  // the checks compare it with every piece saved before it.
  let saving = Promise.resolve();
  const saveInTurn = (results: readonly WrittenPiece[]) =>
    (saving = saving.then(async () => {
      for (const [id, why] of await save(results)) refused.set(id, why);
    }));
  await Promise.all(
    chunks.map((chunk, index) =>
      writeChunk(
        input,
        request,
        modelId,
        system,
        chunkPrompt(
          chunk,
          failedMedia,
          none,
          cmoChunkProof(proof, index, chunks.length),
          said,
        ),
      )
        .catch(() => [] as WrittenPiece[])
        .then(saveInTurn),
    ),
  );

  // The month's own checks over every draft, as save_strategy answers them
  // to Cuso: a repeated opening or phrase, a banned line, the same message
  // in other words. What they find in this batch is rewritten below too.
  const month = await read();
  const drafts = await cmoDraftProblems(month.strategy?.calendar ?? []);
  await chargeCheck(input, EMBEDDING_MODEL, drafts.costUsd);
  const ids = new Set(batch.map((piece) => piece.id));
  for (const problem of drafts.problems) {
    const id = cmoProblemPiece(problem, ids);
    if (!id || refused.has(id)) continue;
    const draft =
      month.strategy?.calendar.find((entry) => entry.id === id)?.draft ?? null;
    refused.set(id, { draft, reason: problem });
  }

  // One repair round: the refused pieces again, each with its reason.
  if (refused.size > 0 && Date.now() - startedAt < REPAIR_START_MS) {
    const again = batch.filter((piece) => refused.has(piece.id));
    const repaired = await Promise.all(
      cmoWriterChunks(again).map((chunk) =>
        writeChunk(
          input,
          request,
          modelId,
          system,
          chunkPrompt(chunk, failedMedia, refused, [], []),
        ).catch(() => [] as WrittenPiece[]),
      ),
    );
    for (const results of repaired) {
      const still = await save(results);
      for (const written of results)
        if (!still.has(written.id)) refused.delete(written.id);
      for (const [id, why] of still) refused.set(id, why);
    }
  }

  // Core schedules what was saved and starts the pictures now, not at the
  // next sync.
  await startCmoProduction(cuso.sokoBotId);
  const after = cmoWriterPieces((await read()).pending);
  const written = batch.filter(
    (piece) => !after.some((left) => left.id === piece.id),
  ).length;
  const left = after.filter((piece) => !refused.has(piece.id)).length;
  return {
    written,
    refused: [...refused].map(([id, why]) => ({
      id,
      title: byId.get(id)?.title ?? id,
      reason: why.reason,
    })),
    left,
    next:
      left > 0
        ? "Call write_month_pieces again for the rest."
        : refused.size > 0
          ? "Fix each refused piece yourself (get_social_post and update_social_post for its words, save_strategy part pieces for its visual or script), then write the pieces your brief lists as yours and report."
          : "Write the pieces your brief lists as yours, then report.",
  };
}

/** The fields a pieces save names a piece by, as the brief gives them. */
function pieceEntry(piece: CmoPiece): CmoCalendarEntry {
  return {
    id: piece.id,
    date: piece.date,
    ...(piece.time ? { time: piece.time } : {}),
    channel: piece.channel,
    format: piece.format,
    title: piece.title,
    status: piece.status,
  };
}
