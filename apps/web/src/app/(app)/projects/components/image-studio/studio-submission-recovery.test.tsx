import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type {
  StudioAsset,
  StudioCatalog,
  StudioJob,
  StudioState,
} from "./types";

const startImageGeneration = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/image-studio/action", () => ({
  startImageGeneration,
  requestImageJobCancel: vi.fn(),
  prepareStudioAssetSocialMedia: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/projects/campaign/studio",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Today" }),
}));
vi.mock("./use-studio-state", () => ({
  useStudioState: ({ initialState }: { initialState: StudioState }) => ({
    state: initialState,
    selectedAsset: null,
    selectAsset: vi.fn(),
    activeJobs: [],
    refresh: vi.fn(),
    loadOlder: vi.fn(),
    hasOlder: false,
    error: null,
  }),
}));

const REJECTION = {
  ok: false,
  uncertain: false,
  kind: "unsupported",
  message: "Unsupported settings",
};

const REFERENCE: StudioAsset = {
  id: "reference-a",
  projectId: "campaign",
  projectName: "Campaign",
  rootId: "reference-a",
  parentId: null,
  version: 1,
  prompt: "Original reference image",
  model: "vendor/model-a",
  width: 1024,
  height: 1024,
  bytes: 1000,
  contentType: "image/png",
  mediaType: "IMAGE",
  video: null,
  createdAt: new Date("2026-09-26T12:00:00Z"),
  jobId: "reference-job",
  settings: { aspectRatio: "1:1", resolution: "1K", outputFormat: "png" },
  contentPath: "/reference-a",
};
const SECOND_REFERENCE: StudioAsset = {
  ...REFERENCE,
  id: "reference-b",
  rootId: "reference-b",
  jobId: "reference-job-b",
};
const PARENT: StudioAsset = {
  ...REFERENCE,
  id: "parent",
  rootId: "parent",
  jobId: "parent-job",
};
const FAILED_JOB: StudioJob = {
  id: "failed-job",
  projectId: "campaign",
  status: "FAILED",
  kind: "EDIT",
  model: "vendor/model-a",
  prompt: "Original campaign brief",
  settings: {
    aspectRatio: "16:9",
    resolution: "2K",
    outputFormat: "jpeg",
    seed: 7,
  },
  parentAssetId: REFERENCE.id,
  referenceAssetIds: [REFERENCE.id],
  video: null,
  assetId: null,
  error: "Provider rejected the request",
  failureReason: "request_not_supported",
  createdAt: new Date("2026-09-26T12:00:00Z"),
  submittedAt: null,
  settledAt: new Date("2026-09-26T12:01:00Z"),
  cancelRequestedAt: null,
  retryMayDuplicateCharge: false,
  credits: null,
  refunded: false,
};

function mount({
  assets = [],
  jobs = [],
  catalog = { ...TEST_CATALOG, models: [TEST_CATALOG.models[0]] },
}: {
  assets?: StudioAsset[];
  jobs?: StudioJob[];
  catalog?: StudioCatalog;
} = {}) {
  return render(
    <ImageStudio
      catalog={catalog}
      initialSelectedAssetId={null}
      initialState={{ assets, jobs, nextCursor: null }}
      labels={TEST_LABELS}
      projectId="campaign"
    />,
  );
}

function promptBox() {
  return screen.getByRole("textbox", { name: "promptPlaceholder" });
}

function chooseAspectRatio(ratio: string) {
  fireEvent.click(screen.getByRole("button", { name: /moreOptions/ }));
  const choice = screen.getByRole("button", { name: ratio });
  fireEvent.click(choice);
  fireEvent.keyDown(choice, { key: "Escape" });
}

function submit(prompt: string) {
  fireEvent.change(promptBox(), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "generateOne" }));
}

function savedSubmission() {
  return screen.findByRole("article", { name: "savedSubmission" });
}

beforeEach(() => vi.resetAllMocks());

describe("submission recovery in the studio", () => {
  it("never replaces a newer draft with an earlier rejected submission", async () => {
    let reject: (value: unknown) => void = () => {};
    startImageGeneration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reject = resolve;
        }),
    );
    mount();
    const prompt = promptBox();
    chooseAspectRatio("4:5");
    submit("Original campaign brief");
    fireEvent.change(prompt, { target: { value: "A newer draft" } });
    reject(REJECTION);
    const recovery = await savedSubmission();
    expect(prompt).toHaveValue("A newer draft");
    fireEvent.click(within(recovery).getByText("viewSavedBrief"));
    expect(
      within(recovery).getByText("Original campaign brief"),
    ).toBeInTheDocument();
    expect(
      within(recovery).getByText(/Model A · 4:5 · 1K/),
    ).toBeInTheDocument();
    const edit = within(recovery).getByRole("button", {
      name: "editSavedBrief",
    });
    expect(edit).toBeDisabled();
    expect(
      within(recovery).getByText("recoveryEditBlocked"),
    ).toBeInTheDocument();
    fireEvent.click(edit);
    expect(prompt).toHaveValue("A newer draft");
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("restores the saved brief and settings into an empty composer for a new submission", async () => {
    startImageGeneration
      .mockResolvedValueOnce(REJECTION)
      .mockResolvedValueOnce({ ok: true, job: { id: "edited-job" } });
    mount();
    chooseAspectRatio("4:5");
    submit("Original campaign brief");
    const recovery = await savedSubmission();
    expect(promptBox()).toHaveValue("");
    fireEvent.click(
      within(recovery).getByRole("button", { name: "editSavedBrief" }),
    );
    expect(promptBox()).toHaveValue("Original campaign brief");
    await waitFor(() => expect(promptBox()).toHaveFocus());
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "moreOptions 4:5 · 1K · png" }),
    ).toBeInTheDocument();
    submit("Adjusted campaign brief");
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(2));
    expect(startImageGeneration.mock.calls[1][0]).toMatchObject({
      prompt: "Adjusted campaign brief",
      modelId: "model-a",
      settings: { aspectRatio: "4:5", resolution: "1K", outputFormat: "png" },
    });
    expect(startImageGeneration.mock.calls[1][0].idempotencyKey).not.toBe(
      startImageGeneration.mock.calls[0][0].idempotencyKey,
    );
  });

  it("protects newer settings with an empty prompt, and Dismiss keeps both draft and settings", async () => {
    startImageGeneration.mockResolvedValueOnce(REJECTION);
    mount();
    submit("Original campaign brief");
    const recovery = await savedSubmission();
    chooseAspectRatio("16:9");
    expect(promptBox()).toHaveValue("");
    expect(
      within(recovery).getByRole("button", { name: "editSavedBrief" }),
    ).toBeDisabled();
    expect(
      within(recovery).getByText("recoveryEditBlocked"),
    ).toBeInTheDocument();
    fireEvent.change(promptBox(), { target: { value: "A newer draft" } });
    fireEvent.click(
      within(recovery).getByRole("button", { name: "dismissSubmission" }),
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(promptBox()).toHaveValue("A newer draft");
    expect(
      screen.getByRole("button", { name: "moreOptions 16:9 · 1K · png" }),
    ).toBeInTheDocument();
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("protects restored settings from another failure after the restored prompt is cleared", async () => {
    startImageGeneration.mockResolvedValue(REJECTION);
    mount();
    chooseAspectRatio("4:5");
    submit("First campaign brief");
    await savedSubmission();
    chooseAspectRatio("16:9");
    submit("Second campaign brief");
    await waitFor(() =>
      expect(
        screen.getAllByRole("article", { name: "savedSubmission" }),
      ).toHaveLength(2),
    );

    const [firstFailure, secondFailure] = screen.getAllByRole("article", {
      name: "savedSubmission",
    });
    fireEvent.click(
      within(firstFailure).getByRole("button", { name: "editSavedBrief" }),
    );
    expect(promptBox()).toHaveValue("First campaign brief");
    fireEvent.change(promptBox(), { target: { value: "" } });

    const edit = within(secondFailure).getByRole("button", {
      name: "editSavedBrief",
    });
    expect(edit).toBeDisabled();
    expect(
      within(secondFailure).getByText("recoveryEditBlocked"),
    ).toBeInTheDocument();
    fireEvent.click(edit);
    expect(promptBox()).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "moreOptions 4:5 · 1K · png" }),
    ).toBeInTheDocument();
    expect(startImageGeneration).toHaveBeenCalledTimes(2);
  });

  it("offers a same-key retry for an uncertain response, without a new-purchase Edit action", async () => {
    startImageGeneration
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({ ok: true, job: { id: "original-job" } });
    mount();
    submit("Paid campaign");
    const recovery = await savedSubmission();
    expect(
      within(recovery).getByText("submissionUnconfirmed"),
    ).toBeInTheDocument();
    expect(
      within(recovery).queryByRole("button", { name: "editSavedBrief" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(recovery).getByRole("button", { name: "retrySubmission" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("article")).not.toBeInTheDocument(),
    );
    expect(startImageGeneration).toHaveBeenCalledTimes(2);
    expect(startImageGeneration.mock.calls[1][0]).toEqual(
      startImageGeneration.mock.calls[0][0],
    );
  });

  it.each([
    {
      description: "saved reference order when gallery order is reversed",
      assets: [REFERENCE, SECOND_REFERENCE],
      referenceAssetIds: [SECOND_REFERENCE.id, REFERENCE.id],
      parentAssetId: SECOND_REFERENCE.id,
    },
    {
      description: "an explicit parent that differs from the references",
      assets: [REFERENCE, SECOND_REFERENCE, PARENT],
      referenceAssetIds: [REFERENCE.id, SECOND_REFERENCE.id],
      parentAssetId: PARENT.id,
    },
    {
      description: "an explicit null parent alongside references",
      assets: [REFERENCE, SECOND_REFERENCE],
      referenceAssetIds: [REFERENCE.id, SECOND_REFERENCE.id],
      parentAssetId: null,
    },
  ])(
    "preserves $description when editing",
    async ({ assets, referenceAssetIds, parentAssetId }) => {
      startImageGeneration
        .mockResolvedValueOnce(REJECTION)
        .mockResolvedValueOnce({ ok: true, job: { id: "edited-job" } });
      mount({
        assets,
        jobs: [{ ...FAILED_JOB, referenceAssetIds, parentAssetId }],
      });
      fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));
      const recovery = await savedSubmission();
      fireEvent.click(
        within(recovery).getByRole("button", { name: "editSavedBrief" }),
      );
      expect(promptBox()).toHaveValue(FAILED_JOB.prompt);
      submit("Adjust the campaign light");
      await waitFor(() =>
        expect(startImageGeneration).toHaveBeenCalledTimes(2),
      );
      expect(startImageGeneration.mock.calls[1][0]).toMatchObject({
        projectId: "campaign",
        prompt: "Adjust the campaign light",
        modelId: "model-a",
        settings: FAILED_JOB.settings,
        parentAssetId,
        referenceAssetIds,
      });
    },
  );

  it("edits one failed leg of a multi-copy batch as one image", async () => {
    startImageGeneration
      .mockResolvedValueOnce(REJECTION)
      .mockResolvedValue({ ok: true, job: { id: "accepted-job" } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /moreOptions/ }));
    const copies = screen.getByRole("button", { name: "2" });
    fireEvent.click(copies);
    fireEvent.keyDown(copies, { key: "Escape" });
    fireEvent.change(promptBox(), {
      target: { value: "Original campaign brief" },
    });
    fireEvent.click(screen.getByRole("button", { name: "generateMany" }));
    const recovery = await savedSubmission();
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(2));
    fireEvent.click(
      within(recovery).getByRole("button", { name: "editSavedBrief" }),
    );
    expect(screen.getByRole("button", { name: "generateOne" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /moreOptions/ }));
    expect(
      screen.getByRole("button", { name: "1", pressed: true }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "1" }), {
      key: "Escape",
    });
    submit("Edit only the rejected image");
    await waitFor(() => expect(startImageGeneration).toHaveBeenCalledTimes(3));
    expect(startImageGeneration.mock.calls[2][0]).toMatchObject({
      prompt: "Edit only the rejected image",
      modelId: "model-a",
      settings: startImageGeneration.mock.calls[0][0].settings,
      parentAssetId: null,
      referenceAssetIds: [],
    });
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("withholds Edit when a saved submission's model leaves the catalog", async () => {
    startImageGeneration.mockResolvedValueOnce(REJECTION);
    const { rerender } = mount();
    submit("Original campaign brief");
    const recovery = await savedSubmission();
    expect(
      within(recovery).getByRole("button", { name: "editSavedBrief" }),
    ).toBeEnabled();

    rerender(
      <ImageStudio
        catalog={{
          ...TEST_CATALOG,
          defaultModelId: "model-b",
          models: [TEST_CATALOG.models[1]],
        }}
        initialSelectedAssetId={null}
        initialState={{ assets: [], jobs: [], nextCursor: null }}
        labels={TEST_LABELS}
        projectId="campaign"
      />,
    );

    expect(
      within(recovery).queryByRole("button", { name: "editSavedBrief" }),
    ).not.toBeInTheDocument();
    expect(
      within(recovery).getByRole("button", { name: "retrySubmission" }),
    ).toBeEnabled();
    expect(promptBox()).toHaveValue("");
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      description: "a reference is not loaded",
      assets: [REFERENCE],
      job: { ...FAILED_JOB, referenceAssetIds: [REFERENCE.id, "missing"] },
    },
    {
      description: "a reference belongs to another project",
      assets: [{ ...REFERENCE, projectId: "other-project" }],
      job: FAILED_JOB,
    },
    {
      description: "the explicit parent is not loaded",
      assets: [REFERENCE],
      job: { ...FAILED_JOB, parentAssetId: "missing-parent" },
    },
    {
      description: "the request targets another project",
      assets: [REFERENCE],
      job: { ...FAILED_JOB, projectId: "other-project" },
    },
    {
      description: "the saved settings are unsupported",
      assets: [REFERENCE],
      job: {
        ...FAILED_JOB,
        settings: { ...FAILED_JOB.settings, aspectRatio: "5:4" as const },
      },
    },
  ])("withholds Edit when $description", async ({ assets, job }) => {
    startImageGeneration.mockResolvedValueOnce(REJECTION);
    mount({ assets, jobs: [job] });
    fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));
    const recovery = await savedSubmission();
    expect(
      within(recovery).queryByRole("button", { name: "editSavedBrief" }),
    ).not.toBeInTheDocument();
    expect(
      within(recovery).getByRole("button", { name: "retrySubmission" }),
    ).toBeEnabled();
    expect(promptBox()).toHaveValue("");
    expect(startImageGeneration).toHaveBeenCalledTimes(1);
  });
});
