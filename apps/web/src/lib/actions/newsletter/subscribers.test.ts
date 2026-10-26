import { revalidatePath } from "next/cache";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  addSubscriber: vi.fn(),
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
  consent: true,
};

function csvForm(values: { csv: string; consent: boolean }) {
  const form = new FormData();
  form.set(
    "csv",
    new Blob([values.csv], { type: "text/csv" }),
    "subscribers.csv",
  );
  form.set("consent", String(values.consent));
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
      consent: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/projects/${TARGET.projectId}/newsletter/subscribers`,
    );
  });

  it.each([false, undefined, "true"])(
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
      values: { email: "one@example.com", consent: true },
    });
    expect(mocks.addSubscriber).toHaveBeenCalledWith(TARGET.projectId, {
      email: "one@example.com",
      name: null,
      consent: true,
    });
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
      consent: true,
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
    expect(mocks.importSubscribers).toHaveBeenCalledWith(
      TARGET.projectId,
      values,
    );
    expect(revalidatePath).toHaveBeenCalled();
  });

  it.each([
    { csv: "email", consent: false },
    { csv: "", consent: true },
    { csv: "a".repeat(5_000_001), consent: true },
    { csv: "é".repeat(2_500_001), consent: true },
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
        values: csvForm({ csv: "a".repeat(5_000_000), consent: true }),
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects forged import bodies and malformed project IDs", async () => {
    expect(
      await importNewsletterSubscribers({
        projectId: TARGET.projectId,
        values: { csv: "email", consent: true },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await importNewsletterSubscribers({
        projectId: "invalid",
        values: csvForm({ csv: "email", consent: true }),
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
        values: csvForm({ csv: "wrong\nvalue", consent: true }),
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
          values: csvForm({ csv: "email", consent: true }),
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
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});
