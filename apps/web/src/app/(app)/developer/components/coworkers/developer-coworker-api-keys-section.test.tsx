import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listApiKeysMock = vi.fn();
const revokeActionMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/services/developer-coworker.service", () => ({
  developerCoworkerService: {
    listApiKeys: (...args: unknown[]) => listApiKeysMock(...args),
  },
}));

vi.mock("@/lib/actions/coworkers/api-keys.action", () => ({
  createDeveloperCoworkerApiKeyAction: vi.fn(),
  revokeDeveloperCoworkerApiKeyAction: (...args: unknown[]) =>
    revokeActionMock(...args),
}));

import { expectConsole } from "@sokosumi/utils/test-console";
import { mockCoreCoworker } from "@/test-fixtures/coworker";

import messages from "../../../../../../messages/en.json";
import { DeveloperCoworkerApiKeysSection } from "./developer-coworker-api-keys-section";

const coworker = mockCoreCoworker();

function key(overrides: Record<string, unknown>) {
  return {
    id: "key-1",
    coworkerId: coworker.id,
    name: "Production",
    keyStart: "coworker_abc",
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function renderSection() {
  const element = await DeveloperCoworkerApiKeysSection({ coworker });
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {element}
    </NextIntlClientProvider>,
  );
}

describe("DeveloperCoworkerApiKeysSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers revoke only for active keys", async () => {
    listApiKeysMock.mockResolvedValue([
      key({ id: "key-active", name: "Production" }),
      key({
        id: "key-revoked",
        name: "Old",
        revokedAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
      key({
        id: "key-expired",
        name: null,
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ]);

    await renderSection();

    expect(listApiKeysMock).toHaveBeenCalledWith(coworker.id);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Unnamed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("revokes the confirmed key", async () => {
    listApiKeysMock.mockResolvedValue([
      key({ id: "key-active", name: "Production" }),
    ]);
    revokeActionMock.mockResolvedValue({
      ok: true,
      value: { keyId: "key-active" },
    });

    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke key" }));

    await waitFor(() =>
      expect(revokeActionMock).toHaveBeenCalledWith({
        coworkerId: coworker.id,
        keyId: "key-active",
      }),
    );
  });

  it("shows the empty state", async () => {
    listApiKeysMock.mockResolvedValue([]);

    await renderSection();

    expect(screen.getByText("No API keys yet.")).toBeInTheDocument();
  });

  it("shows an error when the keys cannot be loaded", async () => {
    const errorCalls = expectConsole(
      "error",
      "Failed to load coworker API keys",
    );
    listApiKeysMock.mockRejectedValue(new Error("Core down"));

    await renderSection();

    expect(errorCalls).toHaveLength(1);
    expect(
      screen.getByText(
        "Could not load the API keys. Reload the page to try again.",
      ),
    ).toBeInTheDocument();
  });
});
