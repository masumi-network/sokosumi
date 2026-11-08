/**
 * Contacts linked to Projects against a real database: a bot links people
 * to a Project with a role, finds them and their companies by Project, and
 * a merge carries the links to the contact kept.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { runContactTool } from "@/lib/soko-bot/contact-tools";
import {
  type ContactActor,
  inContactTransaction,
  mergeContacts,
  upsertContact,
} from "./contacts.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const alice = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const raiseId = randomUUID();
const launchId = randomUUID();
const foreignProjectId = randomUUID();
const actor: ContactActor = { workspaceId, userId: alice, sokoBotId: null };
const hooks = {
  authorize: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
};

function create(name: string, organization: string) {
  return inContactTransaction(
    async (tx) =>
      (
        await upsertContact(tx, actor, {
          name,
          organization,
          channels: [],
          upsert: false,
        })
      ).contact.id,
  );
}

const run = (capability: Parameters<typeof runContactTool>[0], input: object) =>
  runContactTool(capability, input, actor, hooks);

const ids: Record<string, string> = {};

describe.runIf(enabled)("contacts in Projects on PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: alice,
        name: "Alice",
        email: `projects-${alice}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Projects",
        slug: `projects-${organizationId}`,
      },
    });
    await prisma.workspace.createMany({
      data: [{ id: workspaceId, organizationId }, { id: otherWorkspaceId }],
    });
    await prisma.project.createMany({
      data: [
        { id: raiseId, workspaceId, name: "Seed raise" },
        { id: launchId, workspaceId, name: "Launch" },
        {
          id: foreignProjectId,
          workspaceId: otherWorkspaceId,
          name: "Someone else's",
        },
      ],
    });
    ids.ryan = await create("Ryan Green", "Acme Ventures");
    ids.nina = await create("Nina Keller", "Acme Ventures");
    ids.lena = await create("Lena Fox", "Daily Wire");
    ids.mark = await create("Mark Stone", "Stone Capital");
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({
      where: { id: { in: [raiseId, launchId, foreignProjectId] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: alice } });
  });

  it("links a contact with a role, changes it, and keeps it when left out", async () => {
    expect(
      await run("link_contact_to_project", {
        contactId: ids.ryan,
        projectId: raiseId,
        role: "lead investor",
      }),
    ).toEqual({
      contact: { id: ids.ryan, name: "Ryan Green" },
      projectId: raiseId,
      project: "Seed raise",
      role: "lead investor",
      linked: true,
    });
    // The write is checked against the bot's Project scope.
    expect(hooks.authorize).toHaveBeenLastCalledWith(expect.anything(), {
      projectIds: [raiseId],
    });

    await run("link_contact_to_project", {
      contactId: ids.ryan,
      projectId: raiseId,
      role: "investor",
    });
    await run("link_contact_to_project", {
      contactId: ids.ryan,
      projectId: raiseId,
    });
    const detail = (await run("get_contact", { contactId: ids.ryan })) as {
      projects: unknown[];
    };
    expect(detail.projects).toEqual([
      { projectId: raiseId, project: "Seed raise", role: "investor" },
    ]);
    expect(
      await prisma.contactProject.count({ where: { contactId: ids.ryan } }),
    ).toBe(1);
  });

  it("finds a Project's people and the companies they work at", async () => {
    await run("link_contact_to_project", {
      contactId: ids.nina,
      projectId: raiseId,
      role: "partner",
    });
    await run("link_contact_to_project", {
      contactId: ids.mark,
      projectId: raiseId,
    });
    await run("link_contact_to_project", {
      contactId: ids.lena,
      projectId: launchId,
      role: "editor",
    });

    const people = (await run("search_contacts", {
      projectId: raiseId,
      sort: "name",
    })) as { contacts: { name: string }[]; total: number };
    expect(people.total).toBe(3);
    expect(people.contacts.map((contact) => contact.name)).toEqual([
      "Mark Stone",
      "Nina Keller",
      "Ryan Green",
    ]);

    const companies = (await run("count_contacts", {
      projectId: raiseId,
      by: "organization",
    })) as { total: number; groups: { label: string; count: number }[] };
    expect(companies.total).toBe(3);
    expect(companies.groups.map((group) => [group.label, group.count])).toEqual(
      [
        ["Acme Ventures", 2],
        ["Stone Capital", 1],
      ],
    );

    // A ranked search stays inside the Project too.
    const ranked = (await run("search_contacts", {
      projectId: raiseId,
      query: "Acme",
      mode: "words",
    })) as { contacts: { name: string }[]; total: number };
    expect(ranked.contacts.map((contact) => contact.name).sort()).toEqual([
      "Nina Keller",
      "Ryan Green",
    ]);
    const elsewhere = (await run("search_contacts", {
      projectId: launchId,
      query: "Acme",
      mode: "words",
    })) as { total: number };
    expect(elsewhere.total).toBe(0);

    const preview = (await run("bulk_update_contacts", {
      projectId: launchId,
      change: { stage: "PRESS" },
    })) as { matching: number; confirmed: boolean };
    expect(preview).toMatchObject({ matching: 1, confirmed: false });
  });

  it("refuses a Project of another workspace and writes nothing", async () => {
    await expect(
      run("link_contact_to_project", {
        contactId: ids.lena,
        projectId: foreignProjectId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await prisma.contactProject.count({
        where: { projectId: foreignProjectId },
      }),
    ).toBe(0);
  });

  it("unlinks with remove", async () => {
    expect(
      await run("link_contact_to_project", {
        contactId: ids.mark,
        projectId: raiseId,
        remove: true,
      }),
    ).toMatchObject({ linked: false, project: "Seed raise" });
    const detail = (await run("get_contact", { contactId: ids.mark })) as {
      projects: unknown[];
    };
    expect(detail.projects).toEqual([]);
  });

  it("moves a merged contact's Projects to the one kept, keeping its own role", async () => {
    // Nina is in the raise as partner and in the launch; Ryan only in the raise.
    await run("link_contact_to_project", {
      contactId: ids.nina,
      projectId: launchId,
      role: "speaker",
    });
    await inContactTransaction((tx) =>
      mergeContacts(tx, actor, ids.ryan as string, [ids.nina as string]),
    );
    const detail = (await run("get_contact", { contactId: ids.ryan })) as {
      projects: unknown[];
    };
    expect(detail.projects).toEqual([
      { projectId: raiseId, project: "Seed raise", role: "investor" },
      { projectId: launchId, project: "Launch", role: "speaker" },
    ]);
    expect(
      await prisma.contactProject.count({ where: { contactId: ids.nina } }),
    ).toBe(0);
    // A merged contact can no longer be linked.
    await expect(
      run("link_contact_to_project", {
        contactId: ids.nina,
        projectId: raiseId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("drops the links when a Project is deleted", async () => {
    await prisma.project.delete({ where: { id: launchId } });
    expect(
      await prisma.contactProject.count({ where: { projectId: launchId } }),
    ).toBe(0);
  });
});
