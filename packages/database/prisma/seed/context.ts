import type {
  Agent,
  Coworker,
  Organization,
  PrismaClient,
  User,
  Workspace,
} from "../../src/generated/prisma/client.js";

export interface SeedContext {
  prisma: PrismaClient;
  now: Date;
  users: {
    admin: User;
    alice: User;
    bob: User;
    carol: User;
  };
  orgs: {
    acme: Organization;
    bootstrap: Organization;
  };
  workspaces: {
    adminPersonal: Workspace;
    alicePersonal: Workspace;
    bobPersonal: Workspace;
    carolPersonal: Workspace;
    acme: Workspace;
    bootstrap: Workspace;
  };
  agents: {
    freeAgent: Agent;
    fixedAgent: Agent;
    fixedAgentTwo: Agent;
  };
  coworkers: Record<string, Coworker>;
}

export function createSeedContext(prisma: PrismaClient): SeedContext {
  return {
    prisma,
    now: new Date(),
    users: {} as SeedContext["users"],
    orgs: {} as SeedContext["orgs"],
    workspaces: {} as SeedContext["workspaces"],
    agents: {} as SeedContext["agents"],
    coworkers: {},
  };
}
