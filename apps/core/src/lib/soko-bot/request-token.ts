import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

import type {
  SokoBotRequestClaims,
  SokoBotTurnGrantClaims,
} from "@sokosumi/soko-bot";
import { isSokoBotCapability } from "@sokosumi/soko-bot";
import { importSPKI, jwtVerify, SignJWT } from "jose";

const REQUEST_TOKEN_TTL_SECONDS = 60;
const CLOCK_TOLERANCE_SECONDS = 5;

export interface SokoBotSigningKey {
  keyId: string;
  publicKeyPem: string;
}

export interface SokoBotTokenServiceConfig {
  issuer: string;
  requestAudience: string;
  grantAudience: string;
  currentKeyId: string;
  privateKeyPem: string;
  previousPublicKeys?: readonly SokoBotSigningKey[];
}

export interface SignRequestTokenInput {
  userId: string;
  sokoBotId: string;
  workspaceId: string;
  sessionId: string;
  turnId: string;
  /** Preset the runtime should apply (model + extra instructions). */
  model?: string;
  presetId?: string;
  presetInstructions?: string;
  now?: Date;
}

export interface SignTurnGrantInput extends SignRequestTokenInput {
  contextSnapshotId: string;
  memoryRevisionId: string | null;
  memoryVersion: number;
  capabilities: SokoBotTurnGrantClaims["capabilities"];
  deadlineAt: Date;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Soko Bot token is missing ${name}`);
  }
  return value;
}

export class SokoBotTokenService {
  private readonly privateKey: KeyObject;
  private readonly publicKeys = new Map<string, KeyObject | CryptoKey>();

  private constructor(
    private readonly config: SokoBotTokenServiceConfig,
    privateKey: KeyObject,
  ) {
    this.privateKey = privateKey;
    this.publicKeys.set(config.currentKeyId, createPublicKey(privateKey));
  }

  static async create(
    config: SokoBotTokenServiceConfig,
  ): Promise<SokoBotTokenService> {
    const privateKey = createPrivateKey(config.privateKeyPem);
    const service = new SokoBotTokenService(config, privateKey);
    for (const previous of config.previousPublicKeys ?? []) {
      service.publicKeys.set(
        previous.keyId,
        await importSPKI(previous.publicKeyPem, "EdDSA"),
      );
    }
    return service;
  }

  async signRequestToken(input: SignRequestTokenInput): Promise<string> {
    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    return new SignJWT({
      tokenUse: "soko_bot_request",
      userId: input.userId,
      sokoBotId: input.sokoBotId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      ...(input.model ? { model: input.model } : {}),
      ...(input.presetId ? { presetId: input.presetId } : {}),
      ...(input.presetInstructions
        ? { presetInstructions: input.presetInstructions }
        : {}),
    })
      .setProtectedHeader({ alg: "EdDSA", kid: this.config.currentKeyId })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.requestAudience)
      .setSubject(input.userId)
      .setJti(crypto.randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + REQUEST_TOKEN_TTL_SECONDS)
      .sign(this.privateKey);
  }

  async signTurnGrant(input: SignTurnGrantInput): Promise<string> {
    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    const expiresAt = Math.floor(input.deadlineAt.getTime() / 1_000);
    if (expiresAt <= now) throw new Error("Soko Bot turn deadline has passed");

    return new SignJWT({
      tokenUse: "soko_bot_turn_grant",
      userId: input.userId,
      sokoBotId: input.sokoBotId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      contextSnapshotId: input.contextSnapshotId,
      memoryRevisionId: input.memoryRevisionId,
      memoryVersion: input.memoryVersion,
      capabilities: input.capabilities,
    })
      .setProtectedHeader({ alg: "EdDSA", kid: this.config.currentKeyId })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.grantAudience)
      .setSubject(input.userId)
      .setJti(crypto.randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .sign(this.privateKey);
  }

  private async verify(token: string, audience: string) {
    return jwtVerify(
      token,
      async (header) => {
        const key = header.kid ? this.publicKeys.get(header.kid) : undefined;
        if (!key) throw new Error("Unknown Soko Bot signing key");
        return key;
      },
      {
        algorithms: ["EdDSA"],
        issuer: this.config.issuer,
        audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      },
    );
  }

  async verifyRequestToken(token: string): Promise<SokoBotRequestClaims> {
    const { payload } = await this.verify(token, this.config.requestAudience);
    if (payload.tokenUse !== "soko_bot_request") {
      throw new Error("Unexpected Soko Bot token use");
    }
    return {
      issuer: requiredString(payload.iss, "issuer"),
      audience: this.config.requestAudience,
      subject: requiredString(payload.sub, "subject"),
      jwtId: requiredString(payload.jti, "jti"),
      userId: requiredString(payload.userId, "userId"),
      sokoBotId: requiredString(payload.sokoBotId, "sokoBotId"),
      workspaceId: requiredString(payload.workspaceId, "workspaceId"),
      sessionId: requiredString(payload.sessionId, "sessionId"),
      turnId: requiredString(payload.turnId, "turnId"),
      issuedAt: payload.iat ?? 0,
      expiresAt: payload.exp ?? 0,
    };
  }

  async verifyTurnGrant(token: string): Promise<SokoBotTurnGrantClaims> {
    const { payload } = await this.verify(token, this.config.grantAudience);
    if (payload.tokenUse !== "soko_bot_turn_grant") {
      throw new Error("Unexpected Soko Bot token use");
    }
    const capabilities = Array.isArray(payload.capabilities)
      ? payload.capabilities.filter(
          (value) => typeof value === "string" && isSokoBotCapability(value),
        )
      : [];
    return {
      issuer: requiredString(payload.iss, "issuer"),
      audience: this.config.grantAudience,
      subject: requiredString(payload.sub, "subject"),
      jwtId: requiredString(payload.jti, "jti"),
      userId: requiredString(payload.userId, "userId"),
      sokoBotId: requiredString(payload.sokoBotId, "sokoBotId"),
      workspaceId: requiredString(payload.workspaceId, "workspaceId"),
      sessionId: requiredString(payload.sessionId, "sessionId"),
      turnId: requiredString(payload.turnId, "turnId"),
      contextSnapshotId: requiredString(
        payload.contextSnapshotId,
        "contextSnapshotId",
      ),
      memoryRevisionId:
        typeof payload.memoryRevisionId === "string"
          ? payload.memoryRevisionId
          : null,
      memoryVersion:
        typeof payload.memoryVersion === "number" ? payload.memoryVersion : 0,
      capabilities,
      issuedAt: payload.iat ?? 0,
      expiresAt: payload.exp ?? 0,
    };
  }
}
