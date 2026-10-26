import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getEnvMock,
  listOrganizationsMock,
  listOrganizationUrnsMock,
  getOrganizationMock,
  snapshotAvatarMock,
  deleteAvatarMock,
  lockCalendarScopeMock,
  projectFindFirstMock,
  connectionFindFirstMock,
  connectionFindManyMock,
  connectionFindUniqueMock,
  connectionCreateMock,
  auditCreateMock,
  transactionMock,
} = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  listOrganizationsMock: vi.fn(),
  listOrganizationUrnsMock: vi.fn(),
  getOrganizationMock: vi.fn(),
  snapshotAvatarMock: vi.fn(),
  deleteAvatarMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  connectionFindFirstMock: vi.fn(),
  connectionFindManyMock: vi.fn(),
  connectionFindUniqueMock: vi.fn(),
  connectionCreateMock: vi.fn(),
  auditCreateMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getWebAppBaseUrl: () => "https://app.sokosumi.com",
}));
vi.mock("@/clients/social-post-providers/linkedin-organizations", () => ({
  listLinkedInAdministeredOrganizations: listOrganizationsMock,
  listLinkedInAdministeredOrganizationUrns: listOrganizationUrnsMock,
  getLinkedInOrganization: getOrganizationMock,
}));
vi.mock("@/lib/social-account-avatar", () => ({
  snapshotSocialAccountAvatar: snapshotAvatarMock,
  deleteSocialAccountAvatarIfOwned: deleteAvatarMock,
}));
vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
}));

const client = {
  $transaction: transactionMock,
  project: { findFirst: projectFindFirstMock },
  projectSocialConnection: {
    findFirst: connectionFindFirstMock,
    findMany: connectionFindManyMock,
    findUnique: connectionFindUniqueMock,
    create: connectionCreateMock,
  },
  projectSocialConnectionAudit: { create: auditCreateMock },
};
vi.mock("@/lib/db/prisma", () => ({ default: client }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ROW_ID = "44444444-4444-4444-8444-444444444444";
const PAGE_ROW_ID = "55555555-5555-4555-8555-555555555555";
const ORG = "urn:li:organization:777";

const personRow = {
  id: PERSON_ROW_ID,
  projectId: PROJECT_ID,
  provider: "linkedin",
  externalAccountId: "person_42",
  externalHandle: "ada",
  displayName: "Ada",
  avatarUrl: null,
  subscriptionType: null,
  composioConnectedAccountId: "ca_li",
  status: "active",
  activeExternalAccountKey: "linkedin:person_42",
  connectorUserId: "sokosumi:user:user_123",
  connectedAt: new Date("2026-09-03T10:00:00.000Z"),
  disconnectedAt: null,
};
const pageRow = {
  ...personRow,
  id: PAGE_ROW_ID,
  externalAccountId: ORG,
  externalHandle: "example-company",
  displayName: "Example Company",
  avatarUrl: "https://blob.example/social-avatars/logo.png",
  activeExternalAccountKey: `linkedin:${ORG}`,
};
const scope = {
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  socialConnectionId: PERSON_ROW_ID,
};

describe("project social connection pages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getEnvMock.mockReturnValue({ SOCIAL_LINKEDIN_COMPANY_PAGES_ENABLED: true });
    lockCalendarScopeMock.mockResolvedValue(true);
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: null,
      workspace: { organization: null },
    });
    connectionFindManyMock.mockResolvedValue([]);
    connectionFindUniqueMock.mockResolvedValue(personRow);
    getOrganizationMock.mockResolvedValue({
      urn: ORG,
      name: "Example Company",
      vanityName: "example-company",
      logoUrl: "https://media.licdn.com/logo.png",
    });
    snapshotAvatarMock.mockResolvedValue(pageRow.avatarUrl);
    connectionCreateMock.mockResolvedValue(pageRow);
    auditCreateMock.mockResolvedValue({ id: "audit_1" });
    transactionMock.mockImplementation(
      async (callback: (tx: typeof client) => Promise<unknown>) =>
        callback(client),
    );
  });

  describe("listing", () => {
    it("is not found while company pages are disabled, without calling LinkedIn", async () => {
      getEnvMock.mockReturnValue({
        SOCIAL_LINKEDIN_COMPANY_PAGES_ENABLED: false,
      });
      const { listProjectSocialConnectionPages } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(
        listProjectSocialConnectionPages(scope),
      ).rejects.toMatchObject({ status: 404 });
      expect(listOrganizationsMock).not.toHaveBeenCalled();
      expect(connectionFindFirstMock).not.toHaveBeenCalled();
    });

    it("marks pages already added to the Project", async () => {
      connectionFindFirstMock.mockResolvedValue(personRow);
      listOrganizationsMock.mockResolvedValue({
        status: "ok",
        organizations: [
          {
            urn: ORG,
            name: "Example Company",
            vanityName: "example-company",
            logoUrl: null,
          },
          {
            urn: "urn:li:organization:778",
            name: "Second",
            vanityName: null,
            logoUrl: null,
          },
        ],
      });
      connectionFindManyMock.mockResolvedValue([
        { id: PAGE_ROW_ID, externalAccountId: ORG },
      ]);
      const { listProjectSocialConnectionPages } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(listProjectSocialConnectionPages(scope)).resolves.toEqual({
        status: "available",
        pages: [
          {
            externalAccountId: ORG,
            name: "Example Company",
            handle: "example-company",
            logoUrl: null,
            socialConnectionId: PAGE_ROW_ID,
          },
          {
            externalAccountId: "urn:li:organization:778",
            name: "Second",
            handle: null,
            logoUrl: null,
            socialConnectionId: null,
          },
        ],
      });
      expect(listOrganizationsMock).toHaveBeenCalledWith({
        connectedAccountId: "ca_li",
        executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
      });
    });

    it("returns permission missing when the authorization lacks page scopes", async () => {
      connectionFindFirstMock.mockResolvedValue(personRow);
      listOrganizationsMock.mockResolvedValue({
        status: "permission_missing",
        organizations: [],
      });
      const { listProjectSocialConnectionPages } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(listProjectSocialConnectionPages(scope)).resolves.toEqual({
        status: "permission_missing",
        pages: [],
      });
    });

    it("only lists pages for a personal LinkedIn account", async () => {
      connectionFindFirstMock.mockResolvedValue(pageRow);
      const { listProjectSocialConnectionPages } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(
        listProjectSocialConnectionPages({
          ...scope,
          socialConnectionId: PAGE_ROW_ID,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(listOrganizationsMock).not.toHaveBeenCalled();
    });
  });

  describe("adding", () => {
    const input = { ...scope, userId: "user_123", externalAccountId: ORG };

    it("re-verifies the role, then adds the page sharing the profile's authorization", async () => {
      connectionFindFirstMock
        .mockResolvedValueOnce(personRow) // source
        .mockResolvedValueOnce(null) // already added?
        .mockResolvedValueOnce(null); // duplicate inside the transaction
      listOrganizationUrnsMock.mockResolvedValue([ORG]);
      const { addProjectSocialConnectionPage } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(
        addProjectSocialConnectionPage(input),
      ).resolves.toMatchObject({
        id: PAGE_ROW_ID,
        accountType: "organization",
      });
      expect(listOrganizationUrnsMock).toHaveBeenCalledWith({
        connectedAccountId: "ca_li",
        executorUserId: `sokosumi:project-executor:${PROJECT_ID}`,
      });
      expect(snapshotAvatarMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        provider: "linkedin",
        externalAccountId: ORG,
        avatarUrl: "https://media.licdn.com/logo.png",
      });
      expect(connectionCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: "linkedin",
          externalAccountId: ORG,
          externalHandle: "example-company",
          displayName: "Example Company",
          avatarUrl: pageRow.avatarUrl,
          composioConnectedAccountId: "ca_li",
          connectorUserId: personRow.connectorUserId,
          activeExternalAccountKey: `linkedin:${ORG}`,
          status: "active",
        }),
      });
      expect(deleteAvatarMock).not.toHaveBeenCalled();
    });

    it("returns the existing account when the page was already added", async () => {
      connectionFindFirstMock
        .mockResolvedValueOnce(personRow)
        .mockResolvedValueOnce(pageRow);
      const { addProjectSocialConnectionPage } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(
        addProjectSocialConnectionPage(input),
      ).resolves.toMatchObject({ id: PAGE_ROW_ID });
      expect(listOrganizationUrnsMock).not.toHaveBeenCalled();
      expect(connectionCreateMock).not.toHaveBeenCalled();
    });

    it("rejects a page the member does not administer", async () => {
      connectionFindFirstMock
        .mockResolvedValueOnce(personRow)
        .mockResolvedValueOnce(null);
      listOrganizationUrnsMock.mockResolvedValue(["urn:li:organization:1"]);
      const { addProjectSocialConnectionPage } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(addProjectSocialConnectionPage(input)).rejects.toMatchObject(
        { status: 403 },
      );
      expect(connectionCreateMock).not.toHaveBeenCalled();
      expect(snapshotAvatarMock).not.toHaveBeenCalled();
    });

    it("rejects when the authorization lacks page scopes", async () => {
      connectionFindFirstMock
        .mockResolvedValueOnce(personRow)
        .mockResolvedValueOnce(null);
      listOrganizationUrnsMock.mockResolvedValue(null);
      const { addProjectSocialConnectionPage } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(addProjectSocialConnectionPage(input)).rejects.toMatchObject(
        { status: 403 },
      );
      expect(connectionCreateMock).not.toHaveBeenCalled();
    });

    it("rejects a person id", async () => {
      const { addProjectSocialConnectionPage } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(
        addProjectSocialConnectionPage({
          ...input,
          externalAccountId: "person_99",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("is not found while company pages are disabled", async () => {
      getEnvMock.mockReturnValue({
        SOCIAL_LINKEDIN_COMPANY_PAGES_ENABLED: false,
      });
      const { addProjectSocialConnectionPage } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(addProjectSocialConnectionPage(input)).rejects.toMatchObject(
        { status: 404 },
      );
      expect(listOrganizationUrnsMock).not.toHaveBeenCalled();
    });

    it("drops its avatar copy when a concurrent add won", async () => {
      connectionFindFirstMock
        .mockResolvedValueOnce(personRow)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(pageRow);
      listOrganizationUrnsMock.mockResolvedValue([ORG]);
      const { addProjectSocialConnectionPage } = await import(
        "./project-social-connection-pages.service"
      );

      await expect(
        addProjectSocialConnectionPage(input),
      ).resolves.toMatchObject({ id: PAGE_ROW_ID });
      expect(connectionCreateMock).not.toHaveBeenCalled();
      expect(deleteAvatarMock).toHaveBeenCalledWith(
        pageRow.avatarUrl,
        PROJECT_ID,
      );
    });
  });
});
