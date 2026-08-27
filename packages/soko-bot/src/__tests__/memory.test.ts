import { describe, expect, it } from "vitest";

import {
  containsSokoBotSensitiveMaterial,
  createEmptySokoBotMemory,
  parseSokoBotMemory,
  redactSokoBotSensitiveText,
  renderSokoBotMemory,
  SokoBotMemorySecretError,
} from "../memory.js";

describe("Soko Bot memory", () => {
  it("round-trips canonical sections", () => {
    const memory = createEmptySokoBotMemory();
    memory.activeGoals.push("Ship launch");
    memory.preferences.push("Keep updates concise");

    expect(parseSokoBotMemory(renderSokoBotMemory(memory))).toEqual(memory);
  });

  it("normalizes untrusted whitespace", () => {
    const memory = createEmptySokoBotMemory();
    memory.decisions.push("  Use   Eve\nfor runtime ");

    expect(renderSokoBotMemory(memory)).toContain("- Use Eve for runtime");
  });

  it.each([
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "sk-live-51N4xg2pQ7rT9vW3yZ8k",
    "-----BEGIN PRIVATE KEY----- MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
    "card 4242 4242 4242 4242",
  ])("rejects raw credential or payment material on update", (entry) => {
    const markdown = memoryMarkdown(entry);

    expect(() =>
      parseSokoBotMemory(markdown, { secretHandling: "reject" }),
    ).toThrow(SokoBotMemorySecretError);
  });

  it.each([
    // A UUIDv7 whose digit run passes Luhn: "5-9572-30751931" is 13 digits.
    "01a03f23-0fd8-72c5-9572-30751931fe0b",
    "Created task 01a03f23-0fd8-72c5-9572-30751931fe0b for Hannah",
    "sha 9f8e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6",
  ])("keeps identifiers that merely contain digits: %s", (entry) => {
    expect(containsSokoBotSensitiveMaterial(entry)).toBe(false);
    expect(redactSokoBotSensitiveText(entry)).toBe(entry);
  });

  it.each([
    "card 4242 4242 4242 4242",
    "4242424242424242",
    "pay with 4111-1111-1111-1111 today",
  ])("still catches real card numbers: %s", (entry) => {
    expect(containsSokoBotSensitiveMaterial(entry)).toBe(true);
  });

  it("rejects and redacts short Bearer credential values", () => {
    const entry = "Bearer abc123";

    expect(() =>
      parseSokoBotMemory(memoryMarkdown(entry), {
        secretHandling: "reject",
      }),
    ).toThrow(SokoBotMemorySecretError);
    expect(parseSokoBotMemory(memoryMarkdown(entry)).activeGoals).toEqual([
      "[Sensitive value removed]",
    ]);
  });

  it.each([
    "api_key: sokosumi_test_7rT9vW3yZ8kP2mN6",
    "api_token: sokosumi_test_8kP2mN6rT9vW3yZ4",
    "access_token=eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "password: correct-horse-battery-staple",
    "cvv=123",
    "payment_id: pi_3P9rQ2mN6vW8yZ4k",
    "My password is correct-horse-battery-staple",
    "CVV 123",
    "API token custom-value-42",
  ])("rejects secret-bearing key/value entry on update", (entry) => {
    expect(() =>
      parseSokoBotMemory(memoryMarkdown(entry), {
        secretHandling: "reject",
      }),
    ).toThrow(SokoBotMemorySecretError);
  });

  it.each([
    "password is monkey",
    "password was monkey",
    "API key equals pineapple",
    "client secret value is dragon",
    "My password is monkey for production",
    "API key equals pineapple for staging",
    "client secret value is dragon for production",
    'password is "rotated" for production',
    "password is changed, on Monday",
  ])("rejects and redacts described secret values", (entry) => {
    expect(() =>
      parseSokoBotMemory(memoryMarkdown(entry), {
        secretHandling: "reject",
      }),
    ).toThrow(SokoBotMemorySecretError);

    expect(parseSokoBotMemory(memoryMarkdown(entry)).activeGoals).toEqual([
      "[Sensitive value removed]",
    ]);
  });

  it.each([
    "password hunter2",
    "pwd abc12345",
    "private key abc12345",
    "client secret hunter2",
    "token custom-value-42",
    "authorization abc12345",
    "password swordfish",
    "client secret huntertwo",
    "password qwerty",
    "pwd secret",
    "client secret abcdef",
    "API key huntertwo",
    "password P@ssword!",
    "client secret P@ssword!",
    "password reset123",
    "API key rotation-123",
    "token policy.secret",
    'password "policy"',
    "token 'rotation'",
    'API key "ownership"',
    'client secret "access"',
    "password reset!",
    "API key rotation!",
    "token policy?",
    "apikey abcdef",
    "apitoken abcdef",
    "accessToken abcdef",
    "refreshToken abcdef",
    "authToken abcdef",
    "privateKey abcdef",
    "clientSecret abcdef",
    "secret hunter2",
    "secret abcdef",
    "secret P@ssword!",
    "password correcthorsebattery",
    "password sunshine",
    "API key somesecretvalue",
    "API key monkey",
    "Runtime failure: password correcthorsebattery",
  ])("rejects and redacts separatorless secret values", (entry) => {
    expect(() =>
      parseSokoBotMemory(memoryMarkdown(entry), {
        secretHandling: "reject",
      }),
    ).toThrow(SokoBotMemorySecretError);

    expect(parseSokoBotMemory(memoryMarkdown(entry)).activeGoals).toEqual([
      "[Sensitive value removed]",
    ]);
  });

  it.each([
    "DATABASE_PASSWORD=hunter2",
    "OPENAI_API_KEY=qwerty123",
    "databasePassword=hunter2",
    "STRIPE_SECRET_KEY=hunter2",
    "AWS_SECRET_ACCESS_KEY=hunter2",
    "stripeSecretKey=hunter2",
    "awsSecretAccessKey=hunter2",
    "AWSSecretAccessKey=alphabeticvalue",
    "OpenAIAPIKey=alphabeticvalue",
    "sk_test_51N4xg2pQ7rT9vW3yZ8k",
    "rk_test_51N4xg2pQ7rT9vW3yZ8k",
  ])("rejects and redacts explicit assignments and provider keys", (entry) => {
    expect(() =>
      parseSokoBotMemory(memoryMarkdown(entry), {
        secretHandling: "reject",
      }),
    ).toThrow(SokoBotMemorySecretError);
    expect(parseSokoBotMemory(memoryMarkdown(entry)).activeGoals).toEqual([
      "[Sensitive value removed]",
    ]);
  });

  it.each([
    "postgresql://soko:super-secret@db.example.com/core",
    "https://service-user:service-password@example.com/private",
    "redis://default:redis-secret@cache.example.com:6379/0",
    "redis://:hunter2@cache.example.com:6379/0",
    "redis://opaque-token@cache.example.com:6379/0",
  ])("rejects connection URLs containing credentials", (entry) => {
    expect(() =>
      parseSokoBotMemory(memoryMarkdown(entry), {
        secretHandling: "reject",
      }),
    ).toThrow(SokoBotMemorySecretError);
  });

  it("redacts secret-bearing legacy entries during parse and render", () => {
    const parsed = parseSokoBotMemory(
      memoryMarkdown("Database password: legacy-secret-value"),
    );

    expect(parsed.activeGoals).toEqual(["[Sensitive value removed]"]);
    expect(renderSokoBotMemory(parsed)).not.toContain("legacy-secret-value");

    const memory = createEmptySokoBotMemory();
    memory.preferences.push(
      "Use postgresql://soko:legacy-secret@db.example.com/core",
    );
    const rendered = renderSokoBotMemory(memory);
    expect(rendered).toContain("- [Sensitive value removed]");
    expect(rendered).not.toContain("legacy-secret");
  });

  it.each([
    "redis://:hunter2@cache.example.com:6379/0",
    "redis://opaque-token@cache.example.com:6379/0",
  ])(
    "redacts every nonempty URL userinfo form during parse and render",
    (entry) => {
      const parsed = parseSokoBotMemory(memoryMarkdown(entry));

      expect(parsed.activeGoals).toEqual(["[Sensitive value removed]"]);

      const memory = createEmptySokoBotMemory();
      memory.preferences.push(entry);
      const rendered = renderSokoBotMemory(memory);
      expect(rendered).toContain("- [Sensitive value removed]");
      expect(rendered).not.toContain(entry);
    },
  );

  it.each([
    "Reset password policy every quarter",
    "Schedule password reset guidance",
    "Review password security requirements",
    "Document password requirements for users",
    "Document password complexity standards",
    "Document password standards",
    "The password should be rotated regularly",
    "Password must contain twelve characters",
    "Password can contain spaces",
    "Password needs twelve characters",
    "Password length must be twelve",
    "Improve password strength",
    "Password policies require review",
    "Document API token rotation policy",
    "Document API key ownership policy",
    "API key naming convention",
    "Track token budget and token usage",
    "Document token expiration behavior",
    "Review token storage requirements",
    "Review token lifecycle management",
    "Review token refresh strategy",
    "Token may expire after one hour",
    "Review token strategy",
    "Token refreshes nightly",
    "Token refresh.",
    "Document authorization header behavior",
    "Document authorization rules",
    "Document authorization behavior requirements",
    "Authorization will follow workspace rules",
    "Authorization model follows RBAC",
    "Authorization follows RBAC",
    "Schedule private key rotation",
    "Private key custody policy",
    "Plan private key generation ceremony",
    "Review client secret rotation policy",
    "Review client secret validation rules",
    "Review client secret access controls",
    "Review client secret controls",
    "Review payment provider migration",
    "Review CVV policy wording",
    "Review payment token policy",
    "Ask finance which corporate card should fund travel",
    "Use Bearer authentication for service requests",
    "Document Bearer credentials handling",
    "Document Bearer scheme requirements",
    "Document Bearer token handling",
    "Use the database connection guide",
    "Review API key ownership.",
    "Password must.",
    "Always get authorization before hiring agents",
    "Rotate the deploy token quarterly",
    "Password was changed on Monday.",
    "API key is rotated regularly",
    "Password is required for administrators",
    "Password policy",
    "Token rotation",
    "API key ownership",
    "Private key custody",
    "Client secret governance",
    "Password reset",
    "Password requirements",
    "API key rotation",
    "Private key generation",
    "Client secret access.",
  ])("preserves benign security and payment prose", (entry) => {
    const parsed = parseSokoBotMemory(memoryMarkdown(entry), {
      secretHandling: "reject",
    });

    expect(parsed.activeGoals).toEqual([entry]);
  });

  it("scans adversarial credential text in linear time", () => {
    const repeated = 20_000;
    const probes = [
      `Bearer ${")".repeat(repeated)}x`,
      `password is${" ".repeat(repeated)}`,
      `password:${" ".repeat(repeated)}`,
      `cvv${" ".repeat(repeated)}x`,
    ];
    const startedAt = performance.now();

    for (const probe of probes) containsSokoBotSensitiveMaterial(probe);

    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});

function memoryMarkdown(activeGoal: string): string {
  return [
    "# Soko Bot memory",
    "",
    "## Active goals",
    `- ${activeGoal}`,
    "",
    "## Decisions",
    "- None",
    "",
    "## Preferences",
    "- None",
    "",
    "## Follow-ups",
    "- None",
    "",
    "## Blockers",
    "- None",
    "",
  ].join("\n");
}
