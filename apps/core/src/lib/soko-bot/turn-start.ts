import type { SokoBotCapability } from "@sokosumi/soko-bot";
import type { PresetRoute } from "@/lib/soko-bot/classifier";

export interface StartSokoBotTurnInput {
  /**
   * The person the turn acts for: the member who asked, or a personal bot's
   * owner. Null when a shared bot acts on its own (ADR 0057).
   */
  userId: string | null;
  /** The bot by id; omitted means `userId`'s personal bot. */
  sokoBotId?: string;
  workspaceId: string;
  clientTurnId: string;
  message: string;
  source?: "CHAT" | "SCHEDULE" | "ADMIN_RETRY" | "EVENT" | "INGEST";
  /** Trusted occurrence batch supplied by the internal sync workers. */
  eventBatch?: {
    eventId: string;
    entityId: string;
    purpose: string;
    designatedHandlerBotId: string | null;
    delegationIds?: string[];
    /**
     * Delegations whose follow-up plan this turn carries out. Claimed with
     * the turn, so a plan reaches exactly one turn; a lost claim aborts it.
     */
    followUpDelegationIds?: string[];
    status: string;
    taskCursorAt?: Date;
    delegationEventAt?: Date;
  }[];
  /** Version override for this turn (lab); otherwise the bot's version. */
  versionId?: string;
  /**
   * Route for a turn whose prompt Core wrote itself (sync workers, system
   * rhythms, admin replays). Never set from a request body: it skips Jev.
   */
  presetRoute?: PresetRoute;
  /**
   * A background run another turn started: it runs beside the bot's chat on
   * its own computer, with the tools in `presetRoute.capabilities`, and its
   * answer lands in `destinationRoomId`.
   */
  background?: {
    parentTurnId: string;
    title: string;
    destinationRoomId: string | null;
  };
  /** Set when a chat-room mention started the turn; the reply lands there. */
  chat?: {
    mentionId: string;
    responseMessageId: string;
    /** Teammate who asked; turns they trigger are read-only. */
    askedByUserId?: string | null;
    /**
     * Another bot asked. Read-only like a teammate — it answers into a room
     * neither of them owns — and counted against the allowance for unprompted
     * work, because no person decided this turn should happen.
     */
    askedByBot?: boolean;
    /**
     * The person's own words, without the "(a teammate, not your owner)"
     * attribution the model sees. The route is decided on these, so who asks
     * never tilts a plain "yes" towards a clarifying question.
     */
    classifyMessage?: string;
    /** Bot-to-bot hops behind this turn; see lib/soko-bot/chat-chain.ts. */
    chainDepth?: number;
  };
  /**
   * The bot's own schedule this run belongs to. The turn may update or delete
   * that schedule even when its route has no schedule tools.
   */
  ownScheduleId?: string;
  scheduleReservation?: {
    runId: string;
    attempt: number;
    leaseToken: string;
  };
  adminScheduleReservation?:
    | {
        kind: "TERMINAL";
        runId: string;
        expectedStatus: "FAILED" | "DEAD_LETTER";
        expectedAttempt: number;
        previousTurnId: string | null;
        expectedPrompt: string | null;
      }
    | {
        kind: "BOUND_REPLAY";
        runId: string;
        boundTurnId: string;
        attempt: number;
      };
}

export interface SokoBotTurnStartResult {
  turnId: string;
  sokoBotId: string;
  sessionId: string;
  status: string;
  route: string;
  capabilities: readonly SokoBotCapability[];
  duplicate: boolean;
  errorKind?: string | null;
  reconciliationLeaseToken?: string;
}
