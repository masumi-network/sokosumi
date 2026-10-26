import {
  SOCIAL_PUBLIC_PROVIDERS,
  socialPostProviderLabel,
  socialProvidersForWorkspace,
  socialProviderUnavailableMessage,
} from "@sokosumi/utils";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "@/../messages/de.json";
import en from "@/../messages/en.json";
import es from "@/../messages/es.json";
import { publishFailureCopy } from "./social-post-publish-failure";

const formatList = (values: string[]) =>
  createFormatter({ locale: "en" }).list(values, { type: "conjunction" });

const COPY: Record<string, string> = {
  "outcomes.authorizationRevoked":
    "Coworker scheduling access was revoked. Reschedule this post to publish it.",
  "outcomes.connectionInactive": "Account disconnected. Reconnect to retry.",
  "outcomes.missed": "Missed the scheduled time.",
  "failures.rateLimited": "Rate limited. Try again later.",
  "failures.timeout": "Timed out. Try again.",
  "failures.unauthorized": "Reconnect the account.",
  "failures.unavailable": "The platform is down. Try again later.",
  "failures.rejected": "The platform rejected this post.",
  "failures.mediaMissing": "A file is missing.",
  "failures.mediaType": "That file type is not allowed.",
  "failures.generic": "Couldn't publish. Open the post for details.",
};

function t(key: string): string {
  return COPY[key] ?? key;
}

function post(partial: {
  status?: "FAILED" | "MISSED";
  outcome?: string | null;
  errorKind?: string | null;
}) {
  return {
    status: partial.status ?? "FAILED",
    lastAttempt: {
      outcome: partial.outcome ?? "failed_permanent",
      errorKind: partial.errorKind ?? null,
    },
  };
}

describe("publishFailureCopy", () => {
  it("shows Core's actionable message when an X tier downgrade blocks publishing", () => {
    const message =
      "This post is 1,240 characters, but @handle can now post at most 280 characters on X (no X Premium). Shorten it or renew Premium, then retry.";
    expect(
      publishFailureCopy(
        { ...post({ errorKind: "text_limit" }), lastError: message },
        t,
        formatList,
        SOCIAL_PUBLIC_PROVIDERS,
      ),
    ).toBe(message);
  });
  it.each([
    [
      "authorization_revoked",
      "Coworker scheduling access was revoked. Reschedule this post to publish it.",
    ],
    ["connection_inactive", "Account disconnected. Reconnect to retry."],
    ["missed", "Missed the scheduled time."],
  ] as const)("maps outcome %s", (outcome, copy) => {
    expect(
      publishFailureCopy(
        post({
          status: outcome === "missed" ? "MISSED" : "FAILED",
          outcome,
        }),
        t,
        formatList,
        SOCIAL_PUBLIC_PROVIDERS,
      ),
    ).toBe(copy);
  });

  it.each([
    ["rate_limited", "Rate limited. Try again later."],
    ["timeout", "Timed out. Try again."],
    ["unauthorized", "Reconnect the account."],
    ["provider_unavailable", "The platform is down. Try again later."],
    ["rejected", "The platform rejected this post."],
    ["provider_rejected", "The platform rejected this post."],
    ["media_missing", "A file is missing."],
    ["media_type_mismatch", "That file type is not allowed."],
  ] as const)("maps errorKind %s", (errorKind, copy) => {
    expect(
      publishFailureCopy(
        post({ errorKind }),
        t,
        formatList,
        SOCIAL_PUBLIC_PROVIDERS,
      ),
    ).toBe(copy);
  });

  it("never returns a raw provider error", () => {
    expect(
      publishFailureCopy(
        {
          status: "FAILED",
          lastAttempt: {
            outcome: "failed_permanent",
            errorKind: "unknown",
          },
        },
        t,
        formatList,
        SOCIAL_PUBLIC_PROVIDERS,
      ),
    ).toBe("Couldn't publish. Open the post for details.");
  });

  it("falls back when there is no attempt", () => {
    expect(
      publishFailureCopy(
        { status: "FAILED", lastAttempt: null },
        t,
        formatList,
        SOCIAL_PUBLIC_PROVIDERS,
      ),
    ).toBe("Couldn't publish. Open the post for details.");
  });
  it.each([
    ["en", en, "TikTok is coming soon. Available now: {providers}."],
    ["de", de, "TikTok ist bald verfügbar. Jetzt verfügbar: {providers}."],
    [
      "es",
      es,
      "TikTok estará disponible próximamente. Disponible ahora: {providers}.",
    ],
  ] as const)(
    "translates stored availability failures in %s",
    (locale, messages, expected) => {
      const translate = createTranslator({
        locale,
        messages: messages.App.Projects.SocialPosts,
      });
      const formatter = createFormatter({ locale });
      for (const source of [
        {
          ...post({ errorKind: "provider_coming_soon:tiktok" }),
          provider: "x",
        },
        {
          status: "FAILED" as const,
          lastError: socialProviderUnavailableMessage("tiktok", {
            organizationSlug: null,
          }),
        },
      ]) {
        for (const organizationSlug of [null, "utxo"]) {
          const enabledProviders = socialProvidersForWorkspace({
            organizationSlug,
          });
          expect(
            publishFailureCopy(
              source,
              translate,
              (values) => formatter.list(values, { type: "conjunction" }),
              enabledProviders,
            ),
          ).toBe(
            expected.replace(
              "{providers}",
              formatter.list(enabledProviders.map(socialPostProviderLabel), {
                type: "conjunction",
              }),
            ),
          );
        }
      }
    },
  );

  it.each(["tiktok", "instagram", "facebook", "linkedin", "youtube"])(
    "does not mislabel a non-availability %s failure as coming soon",
    (provider) => {
      expect(
        publishFailureCopy(
          { ...post({ errorKind: "rate_limited" }), provider },
          t,
          formatList,
          SOCIAL_PUBLIC_PROVIDERS,
        ),
      ).toBe(COPY["failures.rateLimited"]);
    },
  );
});
