import { revalidatePath } from "next/cache";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  addSubscriber: vi.fn(),
  addSubscribersFromContacts: vi.fn(),
  importSubscribers: vi.fn(),
  updateSubscriber: vi.fn(),
  removeSubscriber: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "App.Projects.Newsletter.Subscribers",
    }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: <T extends object, R>(handler: (params: T) => Promise<R>) =>
    handler,
}));
vi.mock("@/lib/clients/core.client", async () => ({
  CoreApiRequestError: (await import("@/lib/clients/core.request"))
    .CoreApiRequestError,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: mocks,
}));

import {
  addNewsletterSubscriber,
  addNewsletterSubscribersFromContacts,
  changeNewsletterSubscriberStatus,
  importNewsletterSubscribers,
  removeNewsletterSubscriber,
} from "./subscribers";

const TARGET = {
  projectId: "11111111-1111-4111-8111-111111111111",
  subscriberId: "22222222-2222-4222-8222-222222222222",
};
const COPY = en.App.Projects.Newsletter.Subscribers;
const VALUES = {
  email: " PERSON@Example.com ",
  name: " Person ",
  consent: "CONFIRMED",
  consentConfirmed: true,
};

function csvForm(values: {
  csv: string;
  consent?: unknown;
  consentConfirmed?: boolean;
}) {
  const form = new FormData();
  form.set(
    "csv",
    new Blob([values.csv], { type: "text/csv" }),
    "subscribers.csv",
  );
  if (values.consent !== undefined) form.set("consent", String(values.consent));
  form.set("consentConfirmed", String(values.consentConfirmed === true));
  return form;
}

beforeEach(() => vi.resetAllMocks());

describe("newsletter subscriber actions", () => {
  it("normalizes a manual subscriber, ignores forged status/source, and revalidates", async () => {
    mocks.addSubscriber.mockResolvedValue({ id: TARGET.subscriberId });
    expect(
      await addNewsletterSubscriber({
        projectId: TARGET.projectId,
        values: { ...VALUES, status: "PENDING", source: "API" },
      }),
    ).toEqual({ ok: true, value: { id: TARGET.subscriberId } });
    expect(mocks.addSubscriber).toHaveBeenCalledWith(TARGET.projectId, {
      email: "person@example.com",
      name: "Person",
      consent: "CONFIRMED",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/newsletter/subscribers");
  });

  it.each([false, true, undefined, "true", "forged"])(
    "rejects manual consent %s on the server",
    async (consent) => {
      expect(
        await addNewsletterSubscriber({
          projectId: TARGET.projectId,
          values: { ...VALUES, consent },
        }),
      ).toMatchObject({
        ok: false,
        error: { fieldErrors: { consent: expect.any(Array) } },
      });
      expect(mocks.addSubscriber).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid emails and project IDs", async () => {
    expect(
      await addNewsletterSubscriber({
        projectId: TARGET.projectId,
        values: { ...VALUES, email: "invalid" },
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { email: [COPY.Validation.email] } },
    });
    expect(
      await addNewsletterSubscriber({ projectId: "invalid", values: VALUES }),
    ).toMatchObject({ ok: false });
    expect(mocks.addSubscriber).not.toHaveBeenCalled();
  });

  it("allows an omitted name", async () => {
    mocks.addSubscriber.mockResolvedValue({ id: TARGET.subscriberId });
    await addNewsletterSubscriber({
      projectId: TARGET.projectId,
      values: {
        email: "one@example.com",
        consent: "CONFIRMED",
        consentConfirmed: true,
      },
    });
    expect(mocks.addSubscriber).toHaveBeenCalledWith(TARGET.projectId, {
      email: "one@example.com",
      name: null,
      consent: "CONFIRMED",
    });
  });

  it.each([false, undefined])(
    "rejects CONFIRMED without confirmation: %s",
    async (consentConfirmed) => {
      const values = { ...VALUES, consentConfirmed };
      expect(
        await addNewsletterSubscriber({ projectId: TARGET.projectId, values }),
      ).toMatchObject({
        ok: false,
        error: { fieldErrors: { consent: [COPY.Validation.consent] } },
      });
      expect(
        await importNewsletterSubscribers({
          projectId: TARGET.projectId,
          values: csvForm({
            csv: "email",
            consent: "CONFIRMED",
            consentConfirmed,
          }),
        }),
      ).toMatchObject({ ok: false });
      expect(mocks.addSubscriber).not.toHaveBeenCalled();
      expect(mocks.importSubscribers).not.toHaveBeenCalled();
    },
  );

  it("forwards ASK for manual add and CSV import without requiring confirmation", async () => {
    mocks.addSubscriber.mockResolvedValue({ id: TARGET.subscriberId });
    mocks.importSubscribers.mockResolvedValue({ imported: 1 });
    await addNewsletterSubscriber({
      projectId: TARGET.projectId,
      values: { email: "one@example.com", consent: "ASK" },
    });
    expect(mocks.addSubscriber).toHaveBeenCalledWith(TARGET.projectId, {
      email: "one@example.com",
      name: null,
      consent: "ASK",
    });
    await importNewsletterSubscribers({
      projectId: TARGET.projectId,
      values: csvForm({ csv: "email\none@example.com", consent: "ASK" }),
    });
    expect(mocks.importSubscribers).toHaveBeenCalledWith(TARGET.projectId, {
      csv: "email\none@example.com",
      consent: "ASK",
    });
  });

  it.each(["CONFIRMED", "ASK"])(
    "adds selected contacts and lists with %s and returns counts",
    async (consent) => {
      const summary = {
        added: 1,
        alreadySubscribed: 2,
        skippedUnsubscribed: 3,
        skippedBounced: 4,
        skippedNoEmail: 5,
        pendingConfirmation: 6,
      };
      mocks.addSubscribersFromContacts.mockResolvedValue(summary);
      expect(
        await addNewsletterSubscribersFromContacts({
          projectId: TARGET.projectId,
          values: {
            contactIds: [TARGET.subscriberId],
            listIds: [TARGET.projectId],
            consent,
            consentConfirmed: true,
            status: "FORGED",
          },
        }),
      ).toEqual({ ok: true, value: summary });
      expect(mocks.addSubscribersFromContacts).toHaveBeenCalledWith(
        TARGET.projectId,
        {
          contactIds: [TARGET.subscriberId],
          listIds: [TARGET.projectId],
          consent,
        },
      );
      expect(revalidatePath).toHaveBeenCalledWith(
        `/projects/${TARGET.projectId}/newsletter/subscribers`,
      );
    },
  );

  it.each([
    { consent: "ASK" },
    { contactIds: ["invalid"], consent: "ASK" },
    { listIds: ["invalid"], consent: "ASK" },
    { contactIds: [TARGET.subscriberId] },
    { contactIds: [TARGET.subscriberId], consent: "forged" },
    { contactIds: [TARGET.subscriberId], consent: "CONFIRMED" },
    { contactIds: Array(1001).fill(TARGET.subscriberId), consent: "ASK" },
    { listIds: Array(21).fill(TARGET.projectId), consent: "ASK" },
  ])(
    "validates Contacts selections and consent before Core",
    async (values) => {
      expect(
        await addNewsletterSubscribersFromContacts({
          projectId: TARGET.projectId,
          values,
        }),
      ).toMatchObject({ ok: false });
      expect(mocks.addSubscribersFromContacts).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("accepts a whole list alone and rejects a malformed project ID", async () => {
    mocks.addSubscribersFromContacts.mockResolvedValue({ added: 1 });
    await addNewsletterSubscribersFromContacts({
      projectId: TARGET.projectId,
      values: { listIds: [TARGET.subscriberId], consent: "ASK" },
    });
    expect(mocks.addSubscribersFromContacts).toHaveBeenCalledWith(
      TARGET.projectId,
      { contactIds: [], listIds: [TARGET.subscriberId], consent: "ASK" },
    );
    mocks.addSubscribersFromContacts.mockClear();
    expect(
      await addNewsletterSubscribersFromContacts({
        projectId: "invalid",
        values: { listIds: [TARGET.subscriberId], consent: "ASK" },
      }),
    ).toMatchObject({ ok: false });
    expect(mocks.addSubscribersFromContacts).not.toHaveBeenCalled();
  });

  it("maps 409 to a friendly email error without leaking Core details", async () => {
    mocks.addSubscriber.mockRejectedValue(
      new CoreApiRequestError("private", { status: 409 }),
    );
    expect(
      await addNewsletterSubscriber({
        projectId: TARGET.projectId,
        values: VALUES,
      }),
    ).toEqual({
      ok: false,
      error: {
        message: COPY.Add.duplicate,
        fieldErrors: { email: [COPY.Add.duplicate] },
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("imports text unchanged and returns the Core summary", async () => {
    const summary = {
      imported: 1,
      skippedExisting: 1,
      invalid: [{ row: 4, value: "bad" }],
    };
    const values = {
      csv: 'email,name\r\nperson@example.com,"Person,\nOne"',
      consent: "CONFIRMED",
      consentConfirmed: true,
    };
    mocks.importSubscribers.mockResolvedValue(summary);
    expect(
      await importNewsletterSubscribers({
        projectId: TARGET.projectId,
        values: await new Request("http://localhost", {
          method: "POST",
          body: csvForm(values),
        }).formData(),
      }),
    ).toEqual({ ok: true, value: summary });
    expect(mocks.importSubscribers).toHaveBeenCalledWith(TARGET.projectId, {
      csv: values.csv,
      consent: "CONFIRMED",
    });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it.each([
    { csv: "email", consent: false },
    { csv: "", consent: "CONFIRMED", consentConfirmed: true },
    {
      csv: "a".repeat(5_000_001),
      consent: "CONFIRMED",
      consentConfirmed: true,
    },
    {
      csv: "é".repeat(2_500_001),
      consent: "CONFIRMED",
      consentConfirmed: true,
    },
  ])("rejects CSV validation failures before Core", async (values) => {
    expect(
      await importNewsletterSubscribers({
        projectId: TARGET.projectId,
        values: csvForm(values),
      }),
    ).toMatchObject({ ok: false });
    expect(mocks.importSubscribers).not.toHaveBeenCalled();
  });

  it("allows exactly 5 MB", async () => {
    mocks.importSubscribers.mockResolvedValue({
      imported: 0,
      skippedExisting: 0,
      invalid: [],
    });
    expect(
      await importNewsletterSubscribers({
        projectId: TARGET.projectId,
        values: csvForm({
          csv: "a".repeat(5_000_000),
          consent: "CONFIRMED",
          consentConfirmed: true,
        }),
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects forged import bodies and malformed project IDs", async () => {
    expect(
      await importNewsletterSubscribers({
        projectId: TARGET.projectId,
        values: { csv: "email", consent: "CONFIRMED", consentConfirmed: true },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await importNewsletterSubscribers({
        projectId: "invalid",
        values: csvForm({
          csv: "email",
          consent: "CONFIRMED",
          consentConfirmed: true,
        }),
      }),
    ).toMatchObject({ ok: false });
    expect(mocks.importSubscribers).not.toHaveBeenCalled();
  });

  it("maps malformed CSV to a translated recovery message", async () => {
    mocks.importSubscribers.mockRejectedValue(
      new CoreApiRequestError("private", { status: 422 }),
    );
    expect(
      await importNewsletterSubscribers({
        projectId: TARGET.projectId,
        values: csvForm({
          csv: "wrong\nvalue",
          consent: "CONFIRMED",
          consentConfirmed: true,
        }),
      }),
    ).toMatchObject({ ok: false, error: { message: COPY.Import.invalidCsv } });
  });

  it.each(["UNSUBSCRIBED"])(
    "requests the permitted target status %s",
    async (status) => {
      mocks.updateSubscriber.mockResolvedValue({ status });
      expect(
        await changeNewsletterSubscriberStatus({ ...TARGET, status }),
      ).toEqual({ ok: true, value: { status } });
      expect(mocks.updateSubscriber).toHaveBeenCalledWith(
        TARGET.projectId,
        TARGET.subscriberId,
        { status },
      );
      expect(revalidatePath).toHaveBeenCalled();
    },
  );

  it.each(["ACTIVE", "PENDING", "BOUNCED", "forged"])(
    "rejects target status %s",
    async (status) => {
      expect(
        await changeNewsletterSubscriberStatus({ ...TARGET, status }),
      ).toMatchObject({ ok: false });
      expect(mocks.updateSubscriber).not.toHaveBeenCalled();
    },
  );

  it("returns a recovery message for stale status transitions", async () => {
    mocks.updateSubscriber.mockRejectedValue(
      new CoreApiRequestError("private", { status: 409 }),
    );
    expect(
      await changeNewsletterSubscriberStatus({
        ...TARGET,
        status: "UNSUBSCRIBED",
      }),
    ).toMatchObject({ ok: false, error: { message: COPY.transitionError } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("removes a subscriber and returns a serializable success", async () => {
    expect(await removeNewsletterSubscriber(TARGET)).toEqual({
      ok: true,
      value: null,
    });
    expect(mocks.removeSubscriber).toHaveBeenCalledWith(
      TARGET.projectId,
      TARGET.subscriberId,
    );
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("rejects forged subscriber IDs", async () => {
    expect(
      await removeNewsletterSubscriber({ ...TARGET, subscriberId: "invalid" }),
    ).toMatchObject({ ok: false });
    expect(
      await changeNewsletterSubscriberStatus({
        ...TARGET,
        subscriberId: "invalid",
        status: "UNSUBSCRIBED",
      }),
    ).toMatchObject({ ok: false });
    expect(mocks.removeSubscriber).not.toHaveBeenCalled();
    expect(mocks.updateSubscriber).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])(
    "translates Core failure %i for every mutation",
    async (status) => {
      for (const mock of Object.values(mocks))
        mock.mockRejectedValue(new CoreApiRequestError("private", { status }));
      expect(
        await addNewsletterSubscriber({
          projectId: TARGET.projectId,
          values: VALUES,
        }),
      ).toMatchObject({ ok: false, error: { message: COPY.Add.error } });
      expect(
        await importNewsletterSubscribers({
          projectId: TARGET.projectId,
          values: csvForm({
            csv: "email",
            consent: "CONFIRMED",
            consentConfirmed: true,
          }),
        }),
      ).toMatchObject({ ok: false, error: { message: COPY.Import.error } });
      expect(
        await changeNewsletterSubscriberStatus({
          ...TARGET,
          status: "UNSUBSCRIBED",
        }),
      ).toMatchObject({ ok: false, error: { message: COPY.updateError } });
      expect(await removeNewsletterSubscriber(TARGET)).toMatchObject({
        ok: false,
        error: { message: COPY.Remove.error },
      });
      expect(
        await addNewsletterSubscribersFromContacts({
          projectId: TARGET.projectId,
          values: { contactIds: [TARGET.subscriberId], consent: "ASK" },
        }),
      ).toMatchObject({
        ok: false,
        error: { message: COPY.FromContacts.error },
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});
