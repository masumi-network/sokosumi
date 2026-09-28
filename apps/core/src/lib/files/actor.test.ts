import { describe, expect, it } from "vitest";

import type { UserContext } from "@/middleware/auth";
import { fileActorFingerprint, resolveFileActor } from "./actor";

/**
 * Which store a Files query runs against.
 *
 * The actor used to take its organization from the caller's session. API-key
 * and OAuth contexts are always built with `organizationId: null` — there is
 * no active-organization concept for them — so the organization arm of the
 * authorized relation never fired and an authorized integration saw an empty
 * organization Drive. Nothing leaked; the answer was simply wrong, which is
 * the kind of wrong nobody reports.
 */

function sessionContext(organizationId: string | null): UserContext {
  return {
    source: "session",
    actor: "user",
    userId: "user-1",
    organizationId,
    role: "user",
    authenticationMethod: "session",
  } as unknown as UserContext;
}

function apiKeyContext(): UserContext {
  return {
    source: "session",
    actor: "user",
    userId: "user-1",
    // This is the point: never populated for an API key.
    organizationId: null,
    role: "user",
    authenticationMethod: "api_key",
  } as unknown as UserContext;
}

function oauthContext(): UserContext {
  return {
    source: "session",
    actor: "user",
    userId: "user-1",
    organizationId: null,
    role: "user",
    authenticationMethod: "oauth",
  } as unknown as UserContext;
}

describe("resolveFileActor", () => {
  it.each([
    ["an API key", apiKeyContext(), "api_key"],
    ["an OAuth token", oauthContext(), "oauth"],
  ])(
    "gives %s the organization the request resolved to",
    (_label, context, kind) => {
      const actor = resolveFileActor(context, { organizationId: "org-7" });

      expect(actor.kind).toBe(kind);
      // Without this the organization arm of the authorized SQL cannot fire.
      expect(actor.organizationId).toBe("org-7");
    },
  );

  it("keeps a personal request personal even with an active organization", () => {
    // The mirror of the same defect: the personal arm requires a null
    // organization, so a session user with one active saw nothing in their
    // own drive.
    const actor = resolveFileActor(sessionContext("org-7"), {
      organizationId: null,
    });

    expect(actor.kind).toBe("interactive");
    expect(actor.organizationId).toBeNull();
  });

  it("falls back to the session's organization when no scope is given", () => {
    expect(resolveFileActor(sessionContext("org-7")).organizationId).toBe(
      "org-7",
    );
    expect(resolveFileActor(sessionContext(null)).organizationId).toBeNull();
  });

  it("still tells a coworker apart from a session", () => {
    const coworker = {
      source: "context",
      userId: "user-1",
      organizationId: "org-7",
    } as unknown as UserContext;

    expect(resolveFileActor(coworker, { organizationId: "org-7" }).kind).toBe(
      "coworker",
    );
  });
});

describe("fileActorFingerprint", () => {
  it("separates the same user in two different stores", () => {
    const personal = resolveFileActor(apiKeyContext(), {
      organizationId: null,
    });
    const organization = resolveFileActor(apiKeyContext(), {
      organizationId: "org-7",
    });

    expect(fileActorFingerprint(personal, "workspace-1")).not.toBe(
      fileActorFingerprint(organization, "workspace-1"),
    );
  });

  it("separates two actor kinds with the same identity", () => {
    const key = resolveFileActor(apiKeyContext(), { organizationId: "org-7" });
    const oauth = resolveFileActor(oauthContext(), { organizationId: "org-7" });

    expect(fileActorFingerprint(key, "workspace-1")).not.toBe(
      fileActorFingerprint(oauth, "workspace-1"),
    );
  });
});
