/**
 * Companies against a real database: grouping people by domain and name,
 * the relationship they add up to, editing facts, and the website lookup
 * (with a fake page and model).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { runContactTool } from "@/lib/soko-bot/contact-tools";
import {
  companyWarmth,
  enrichCompanies,
  getCompany,
  listCompanies,
  pageText,
  updateCompany,
  workspacesWithPendingCompanies,
} from "./contact-companies.service";
import {
  type ContactActor,
  contactCompanyMemberIds,
  inContactTransaction,
  logContactInteraction,
  setContactArchived,
  upsertContact,
} from "./contacts.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const alice = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const actor: ContactActor = { workspaceId, userId: alice, sokoBotId: null };

function create(input: Partial<Parameters<typeof upsertContact>[2]>) {
  return inContactTransaction(
    async (tx) =>
      (
        await upsertContact(tx, actor, {
          channels: [],
          upsert: false,
          ...input,
        })
      ).contact,
  );
}

describe("companyWarmth", () => {
  it("names how recent the last contact was", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    expect(companyWarmth(ago(3), now)).toBe("warm");
    expect(companyWarmth(ago(90), now)).toBe("cooling");
    expect(companyWarmth(ago(400), now)).toBe("cold");
    expect(companyWarmth(null, now)).toBe("none");
  });
});

describe("pageText", () => {
  it("keeps title, descriptions and text, and finds the LinkedIn page", () => {
    const page = pageText(`<html><head><title>Acme</title>
      <meta name="description" content="Robots for warehouses"></head>
      <body><script>x()</script><p>Made in Zurich &amp; Berlin</p>
      <a href="https://www.linkedin.com/company/acme-robotics/">in</a></body></html>`);
    expect(page.text).toContain("Robots for warehouses");
    expect(page.text).toContain("Made in Zurich & Berlin");
    expect(page.text).not.toContain("x()");
    expect(page.linkedinUrl).toBe(
      "https://www.linkedin.com/company/acme-robotics/",
    );
  });

  it("reads a hostile page in linear time", () => {
    const started = Date.now();
    pageText("<script>".repeat(187_500));
    pageText(`<p>${"<style>".repeat(100_000)}`);
    pageText("<".repeat(200_000));
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe.runIf(enabled)("companies on PostgreSQL", () => {
  let ninaId = "";

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: alice,
        name: "Alice",
        email: `companies-${alice}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Companies",
        slug: `companies-${organizationId}`,
      },
    });
    await prisma.workspace.create({
      data: { id: workspaceId, organizationId },
    });
    ninaId = (
      await create({
        name: "Nina Keller",
        organization: "Acme Robotics",
        stage: "PARTNER",
        nextStep: "Send the pilot plan",
        channels: [{ type: "EMAIL", value: "nina@acme.com" }],
      })
    ).id;
    // No organization written, same company domain: the same company.
    await create({
      name: "Tom Berger",
      stage: "LEAD",
      channels: [{ type: "EMAIL", value: "tom@acme.com" }],
    });
    await create({ name: "Sara Blum", organization: "Blum Studio" });
    await inContactTransaction((tx) =>
      logContactInteraction(tx, actor, ninaId, {
        occurredAt: new Date().toISOString(),
        channel: "MEETING",
        summary: "Pilot kickoff",
      }),
    );
  });

  afterAll(async () => {
    await prisma.contactCompany.deleteMany({ where: { workspaceId } });
    await prisma.contact.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: alice } });
  });

  it("lists companies with the relationship their people add up to", async () => {
    const page = await listCompanies(actor, { limit: 10 });
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({
      name: "Acme Robotics",
      domain: "acme.com",
      website: "https://acme.com",
      people: 2,
      teammates: 1,
      interactions: 1,
      warmth: "warm",
      strongestStage: "PARTNER",
    });
    expect(page.items[1]).toMatchObject({
      name: "Blum Studio",
      domain: null,
      people: 1,
      warmth: "none",
      strongestStage: "CONTACT",
    });
    expect(
      (await listCompanies(actor, { search: "acme.com", limit: 10 })).total,
    ).toBe(1);
  });

  it("reads one company with its people, teammates and next steps", async () => {
    const [acme] = (await listCompanies(actor, { limit: 1 })).items;
    const detail = await getCompany(actor, acme?.id ?? "");
    expect(detail.people.map((person) => person.name)).toEqual([
      "Nina Keller",
      "Tom Berger",
    ]);
    expect(detail.teammates).toMatchObject([
      { id: alice, name: "Alice", people: 1 },
    ]);
    expect(detail.nextSteps).toEqual([
      {
        contactId: ninaId,
        name: "Nina Keller",
        nextStep: "Send the pilot plan",
        followUpAt: null,
      },
    ]);
    expect(detail.recentInteractions).toMatchObject([
      { contactId: ninaId, summary: "Pilot kickoff", channel: "MEETING" },
    ]);
  });

  it("changes facts at the version read, and refuses a stale one", async () => {
    const [acme] = (await listCompanies(actor, { limit: 1 })).items;
    const id = acme?.id ?? "";
    const changed = await updateCompany(actor, id, {
      version: 1,
      whyItMatters: "Our first hardware partner.",
    });
    expect(changed).toMatchObject({
      whyItMatters: "Our first hardware partner.",
      version: 2,
    });
    await expect(
      updateCompany(actor, id, { version: 1, industry: "Robotics" }),
    ).rejects.toThrow(/changed meanwhile/);
  });

  it("reads a company's website once and fills only empty facts", async () => {
    const fetched: string[] = [];
    const result = await enrichCompanies(workspaceId, {
      limit: 5,
      usd: 1,
      deps: {
        fetchPage: async (url) => {
          fetched.push(url);
          return `<title>Acme</title><p>Warehouse robots</p>
            <a href="https://linkedin.com/company/acme">in</a>`;
        },
        generate: async () => ({
          text: '{"description": "Builds warehouse robots.", "industry": "Robotics", "size": null, "headquarters": "Zurich, Switzerland"}',
          costUsd: 0.0001,
        }),
      },
    });
    // Only the company with a domain has a site to read.
    expect(fetched).toEqual(["https://acme.com"]);
    expect(result).toEqual({ looked: 1, filled: 1, costUsd: 0.0001 });
    const [acme] = (await listCompanies(actor, { limit: 1 })).items;
    expect(acme).toMatchObject({
      description: "Builds warehouse robots.",
      industry: "Robotics",
      headquarters: "Zurich, Switzerland",
      linkedinUrl: "https://linkedin.com/company/acme",
      whyItMatters: "Our first hardware partner.",
    });
    expect(
      (await enrichCompanies(workspaceId, { limit: 5, usd: 1 })).looked,
    ).toBe(0);
  });

  it("lets a Soko Bot find a company and read its people compactly", async () => {
    const hooks = {
      authorize: async () => undefined,
      commit: async () => undefined,
    };
    const found = (await runContactTool(
      "search_companies",
      { industry: "robot" },
      actor,
      hooks,
    )) as { companies: { id: string; name: string }[]; total: number };
    expect(found.companies.map((company) => company.name)).toEqual([
      "Acme Robotics",
    ]);
    const detail = (await runContactTool(
      "get_company",
      { companyId: found.companies[0]?.id },
      actor,
      hooks,
    )) as { people: Record<string, unknown>[] };
    expect(detail.people[0]).not.toHaveProperty("customFields");
    expect(detail.people[0]).toMatchObject({ name: "Nina Keller" });
    const people = (await runContactTool(
      "search_contacts",
      { company: "acme robotics" },
      actor,
      hooks,
    )) as { total: number };
    expect(people.total).toBe(2);
  });

  it("keeps a company's row when its first company address arrives", async () => {
    const lena = await create({ name: "Lena Fox", organization: "Foxworks" });
    const before = (await listCompanies(actor, { name: "Foxworks", limit: 5 }))
      .items;
    expect(before).toHaveLength(1);
    const foxworks = before[0];
    await updateCompany(actor, foxworks?.id ?? "", {
      version: foxworks?.version ?? 1,
      whyItMatters: "Design partner.",
    });
    await prisma.contactChannel.create({
      data: {
        workspaceId,
        contactId: lena.id,
        type: "EMAIL",
        value: "lena@foxworks.io",
      },
    });
    // The full listing notices the new key and moves the row to it.
    await listCompanies(actor, { limit: 50 });
    const after = (await listCompanies(actor, { name: "Foxworks", limit: 5 }))
      .items;
    expect(after).toMatchObject([
      {
        id: foxworks?.id,
        domain: "foxworks.io",
        whyItMatters: "Design partner.",
        people: 1,
      },
    ]);
  });

  it("finds a renamed company by its new name, people included", async () => {
    const [blum] = (
      await listCompanies(actor, { name: "Blum Studio", limit: 5 })
    ).items;
    await updateCompany(actor, blum?.id ?? "", {
      version: blum?.version ?? 1,
      name: "Blum & Partners",
    });
    expect(
      (await listCompanies(actor, { search: "partners", limit: 5 })).items.map(
        (company) => company.id,
      ),
    ).toEqual([blum?.id]);
    expect(
      (await listCompanies(actor, { name: "Blum & Partners", limit: 5 })).items,
    ).toHaveLength(1);
    const hooks = {
      authorize: async () => undefined,
      commit: async () => undefined,
    };
    expect(
      (
        (await runContactTool(
          "search_contacts",
          { company: "Blum & Partners" },
          actor,
          hooks,
        )) as { total: number }
      ).total,
    ).toBe(1);
  });

  it("never overwrites what someone wrote while the site was read", async () => {
    const [blum] = (
      await listCompanies(actor, { name: "Blum Studio", limit: 5 })
    ).items;
    await prisma.contactCompany.update({
      where: { id: blum?.id },
      data: { website: "https://blum.studio", enrichedAt: null },
    });
    await enrichCompanies(workspaceId, {
      limit: 5,
      usd: 1,
      deps: {
        fetchPage: async () => {
          // A teammate saves a description meanwhile.
          await prisma.contactCompany.update({
            where: { id: blum?.id },
            data: {
              description: "Written by Alice.",
              version: { increment: 1 },
            },
          });
          return "<p>Studio</p>";
        },
        generate: async () => ({
          text: '{"description": "Scraped.", "industry": "Design"}',
          costUsd: 0,
        }),
      },
    });
    const row = await prisma.contactCompany.findUniqueOrThrow({
      where: { id: blum?.id },
    });
    // A name-only company with a website is read too.
    expect(row).toMatchObject({
      description: "Written by Alice.",
      industry: "Design",
    });
    expect(row.enrichedAt).not.toBeNull();
  });

  it("moves a company's row even when a filtered read meets the new key first", async () => {
    const kai = await create({ name: "Kai Ost", organization: "Ostwerk" });
    const [ostwerk] = (await listCompanies(actor, { limit: 50 })).items.filter(
      (company) => company.name === "Ostwerk",
    );
    await updateCompany(actor, ostwerk?.id ?? "", {
      version: ostwerk?.version ?? 1,
      whyItMatters: "Supplier.",
    });
    await prisma.contactChannel.create({
      data: {
        workspaceId,
        contactId: kai.id,
        type: "EMAIL",
        value: "kai@ostwerk.de",
      },
    });
    // The header's exact lookup comes first, not a full listing.
    expect(
      (await listCompanies(actor, { name: "Ostwerk", limit: 5 })).items,
    ).toMatchObject([
      { id: ostwerk?.id, domain: "ostwerk.de", whyItMatters: "Supplier." },
    ]);
    expect(
      await prisma.contactCompany.count({
        where: { workspaceId, name: "Ostwerk" },
      }),
    ).toBe(1);
    // A new address moves domain and default website, and queues a lookup.
    await prisma.contactChannel.updateMany({
      where: { contactId: kai.id, type: "EMAIL" },
      data: { value: "kai@ostwerk.com" },
    });
    await listCompanies(actor, { limit: 50 });
    expect(
      await prisma.contactCompany.findUniqueOrThrow({
        where: { id: ostwerk?.id },
      }),
    ).toMatchObject({
      key: "d:ostwerk.com",
      domain: "ostwerk.com",
      website: "https://ostwerk.com",
      enrichedAt: null,
    });
  });

  it("leaves a company queued when its website changed during a lookup", async () => {
    const [ostwerk] = (
      await listCompanies(actor, { name: "Ostwerk", limit: 5 })
    ).items;
    await enrichCompanies(workspaceId, {
      limit: 10,
      usd: 1,
      deps: {
        fetchPage: async (url) => {
          if (url === "https://ostwerk.com")
            await prisma.contactCompany.update({
              where: { id: ostwerk?.id },
              data: { website: "https://ostwerk.example", enrichedAt: null },
            });
          return "<p>Old site</p>";
        },
        generate: async () => ({
          text: '{"description": "From the old site."}',
          costUsd: 0,
        }),
      },
    });
    expect(
      await prisma.contactCompany.findUniqueOrThrow({
        where: { id: ostwerk?.id },
      }),
    ).toMatchObject({ description: null, enrichedAt: null });
  });

  it("reads a company by id after its people moved to a new key", async () => {
    const kai = await create({ name: "Kai Moss", organization: "Mossworks" });
    const [moss] = (await listCompanies(actor, { name: "Mossworks", limit: 5 }))
      .items;
    await prisma.contactChannel.create({
      data: {
        workspaceId,
        contactId: kai.id,
        type: "EMAIL",
        value: "kai@mossworks.io",
      },
    });
    const company = await getCompany(actor, moss?.id ?? "");
    expect(company).toMatchObject({
      company: { id: moss?.id, domain: "mossworks.io", people: 1 },
      people: [{ id: kai.id }],
    });
  });

  it("restores a renamed company's archived people by what they wrote", async () => {
    const ivo = await create({
      name: "Ivo Reed",
      organization: "Reedcraft",
      channels: [{ type: "EMAIL", value: "ivo@reedcraft.io" }],
    });
    const [reed] = (await listCompanies(actor, { name: "Reedcraft", limit: 5 }))
      .items;
    await updateCompany(actor, reed?.id ?? "", {
      version: reed?.version ?? 1,
      name: "Reed Studio",
    });
    await prisma.contact.update({
      where: { id: ivo.id },
      data: { archivedAt: new Date() },
    });
    expect(
      await contactCompanyMemberIds(workspaceId, "Reed Studio", {
        includeArchived: true,
      }),
    ).toEqual([ivo.id]);
  });

  it("remembers a spelling written after the company was listed", async () => {
    const ada = await create({
      name: "Ada Vale",
      organization: "Valeworks",
      channels: [{ type: "EMAIL", value: "ada@valeworks.io" }],
    });
    const [vale] = (await listCompanies(actor, { name: "Valeworks", limit: 5 }))
      .items;
    await prisma.contact.update({
      where: { id: ada.id },
      data: { organization: "Vale Labs" },
    });
    await updateCompany(actor, vale?.id ?? "", {
      version: vale?.version ?? 1,
      name: "Vale Group",
    });
    await inContactTransaction((tx) =>
      setContactArchived(tx, actor, ada.id, true),
    );
    expect(
      await contactCompanyMemberIds(workspaceId, "Vale Group", {
        includeArchived: true,
      }),
    ).toEqual([ada.id]);
  });

  it("stops waiting on a company nobody works at any more", async () => {
    const solo = await create({
      name: "Uma Lone",
      organization: "Lonely",
      channels: [{ type: "EMAIL", value: "uma@lonely.io" }],
    });
    await listCompanies(actor, { limit: 50 });
    await prisma.contact.update({
      where: { id: solo.id },
      data: { archivedAt: new Date() },
    });
    await listCompanies(actor, { limit: 50 });
    const row = await prisma.contactCompany.findFirstOrThrow({
      where: { workspaceId, key: "d:lonely.io" },
    });
    expect(row).toMatchObject({ enrichedAt: null });
    expect(row.inactiveSince).not.toBeNull();
    // Discovery passes over it: only active companies keep a run coming.
    expect(
      await prisma.contactCompany.count({
        where: { id: row.id, enrichedAt: null, inactiveSince: null },
      }),
    ).toBe(0);
    expect(await workspacesWithPendingCompanies(100)).toContain(workspaceId);
    // Back with people, its lookup is due again.
    await prisma.contact.update({
      where: { id: solo.id },
      data: { archivedAt: null },
    });
    await listCompanies(actor, { limit: 50 });
    expect(
      await prisma.contactCompany.findFirstOrThrow({
        where: { workspaceId, key: "d:lonely.io" },
      }),
    ).toMatchObject({ inactiveSince: null, enrichedAt: null });
  });

  it("moves a row edited meanwhile with what it holds, never a second row", async () => {
    const ines = await create({
      name: "Ines Rot",
      organization: "Rotfabrik",
      channels: [{ type: "EMAIL", value: "ines@rot.example" }],
    });
    const [rot] = (await listCompanies(actor, { name: "Rotfabrik", limit: 5 }))
      .items;
    await prisma.contactChannel.updateMany({
      where: { contactId: ines.id },
      data: { value: "ines@rotfabrik.example" },
    });
    // A teammate saves a custom website just before the move is written.
    const original = prisma.contactCompany.updateMany.bind(
      prisma.contactCompany,
    );
    let raced = false;
    const spy = vi
      .spyOn(prisma.contactCompany, "updateMany")
      .mockImplementation((async (args: { data?: { key?: string } }) => {
        if (!raced && args.data?.key) {
          raced = true;
          await prisma.contactCompany.update({
            where: { id: rot?.id },
            data: {
              website: "https://custom.example",
              version: { increment: 1 },
            },
          });
        }
        return original(args as never);
      }) as never);
    await listCompanies(actor, { limit: 50 });
    spy.mockRestore();
    expect(raced).toBe(true);
    const rows = await prisma.contactCompany.findMany({
      where: { workspaceId, name: "Rotfabrik" },
    });
    expect(rows).toMatchObject([
      {
        id: rot?.id,
        key: "d:rotfabrik.example",
        website: "https://custom.example",
      },
    ]);
  });

  it("wakes a paused company found again by name", async () => {
    const [lonely] = (
      await prisma.contactCompany.findMany({
        where: { workspaceId, key: "d:lonely.io" },
      })
    ).map((row) => row.id);
    const uma = await prisma.contact.findFirstOrThrow({
      where: { workspaceId, name: "Uma Lone" },
    });
    await prisma.contact.update({
      where: { id: uma.id },
      data: { archivedAt: new Date() },
    });
    await listCompanies(actor, { limit: 50 });
    await prisma.contact.update({
      where: { id: uma.id },
      data: { archivedAt: null },
    });
    await listCompanies(actor, { name: "Lonely", limit: 5 });
    expect(
      await prisma.contactCompany.findUniqueOrThrow({ where: { id: lonely } }),
    ).toMatchObject({ inactiveSince: null });
  });
});
