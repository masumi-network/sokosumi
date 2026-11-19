import { expect, it, vi } from "vitest";
import { AiGatewayBudgetError } from "@/lib/ai-gateway-budget";
import { embedStaleContacts } from "@/services/contact-search.service";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import { ContactCaptureService } from "./contact-capture.service";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotIntegration: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/services/contact-enrichment.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./contact-enrichment.service")>()),
  enrichWorkspaceContacts: vi.fn(),
}));
vi.mock("@/services/contact-scores.service", () => ({
  refreshContactFamiliarity: vi.fn(),
  judgeWorkspaceImportance: vi.fn(),
}));
vi.mock("@/services/contact-companies.service", () => ({
  enrichCompanies: vi.fn().mockResolvedValue({
    looked: 0,
    filled: 0,
    costUsd: 0,
  }),
}));
vi.mock("@/services/contact-search.service", () => ({
  embedStaleContacts: vi.fn(),
}));

it("records an incomplete embedding pass without another error on a budget refusal", async () => {
  vi.mocked(embedStaleContacts).mockRejectedValue(new AiGatewayBudgetError());
  expectCoreLog("error", "Could not update contact search for a workspace", 0);

  await new ContactCaptureService().captureWorkspace("workspace-1", () => true);

  expect(embedStaleContacts).toHaveBeenCalledTimes(1);
  expect(coreLogEvents()).toContainEqual(
    expect.objectContaining({
      operation: "contact_capture",
      contactSearch: { embedded: 0, failed: true, costUsd: 0 },
    }),
  );
});
