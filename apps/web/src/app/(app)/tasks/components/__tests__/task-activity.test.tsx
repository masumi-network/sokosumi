import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import type { TaskEvent } from "@/lib/clients/generated/core";
import { Channel, TaskStatus } from "@/lib/clients/generated/core";

const {
  uploadTaskAttachmentMock,
  toastCustomMock,
  toastDismissMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  uploadTaskAttachmentMock: vi.fn(),
  toastCustomMock: vi.fn(),
  toastDismissMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const labels: Record<string, string> = {
      authenticate: "Authenticate",
      "billingCta.upgradePlan": "Get more credits",
      "billingCta.addCredits": "Add credits",
      "billingCta.placeholder":
        "This task needs credits to continue. Open billing to proceed.",
      "billingCta.statusUnavailable": "This task is out of credits.",
      actionChargedCredits: "charged {credits} credits",
      actionTriedChargedCredits: "tried to charge {credits} credits",
      sendWith: "Send with",
      ctrl: "Ctrl",
      uploadFileErrorRetry: "Failed to upload file, please try again!",
      fileLabel: "File",
      "channelApp.sokosumi": "Sokosumi",
      "channelApp.slack": "Slack",
      "channelApp.teams": "Teams",
      "channelApp.email": "Email",
      "channelApp.linear": "Linear",
      "channelApp.github": "GitHub",
      "channelApp.whatsapp": "WhatsApp",
      "channelApp.telegram": "Telegram",
      "channelApp.signal": "Signal",
      "channelApp.discord": "Discord",
      "channelApp.chat": "Chat",
      "channelApp.unknown": "Unknown",
    };

    const translator = (
      key: string,
      values?: Record<string, string | number>,
    ) => {
      if (key === "originFromApp") {
        return `from ${values?.appName ?? ""}`.trim();
      }

      if (key === "actorOrchestratorWithOwner") {
        return `${values?.assistant ?? ""} · ${values?.owner ?? ""}`.trim();
      }

      if (
        key === "actionChargedCredits" ||
        key === "actionTriedChargedCredits"
      ) {
        return (labels[key] ?? key).replace(
          "{credits}",
          String(values?.credits ?? ""),
        );
      }

      return labels[key] ?? key;
    };

    translator.raw = (key: string) => {
      if (key === "uploadingFile") {
        return "Uploading {fileName}";
      }

      if (key === "uploadingFiles") {
        return "Uploading {count} files";
      }

      return labels[key];
    };

    return translator;
  },
}));

vi.mock("@/hooks/use-os-detection", () => ({
  useOSDetection: () => ({
    os: "MacOS",
    isMobile: false,
  }),
}));

vi.mock("@/lib/actions/task/action", () => ({
  createTaskComment: vi.fn(),
}));

vi.mock("@/lib/utils/task-attachments.client", () => ({
  uploadTaskAttachment: (...args: unknown[]) =>
    uploadTaskAttachmentMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    custom: (...args: unknown[]) => toastCustomMock(...args),
    dismiss: (...args: unknown[]) => toastDismissMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

vi.mock("@/components/expandable-markdown", () => ({
  ExpandableMarkdown: ({ content }: { content: string }) => (
    <div>{content}</div>
  ),
}));

vi.mock("@/components/jobs/job-details/file-chip-with-metadata", () => ({
  FileChipMiniPreviewWithMetadata: ({ url }: { url: string }) => (
    <div>{url}</div>
  ),
}));

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: ({
    seed,
    alt,
    animate,
  }: {
    seed: string | null;
    alt?: string;
    animate?: boolean;
  }) => (
    <div
      data-testid="assistant-orb"
      data-seed={seed ?? ""}
      data-animate={animate === false ? "false" : "true"}
      aria-label={alt}
    />
  ),
}));

function createEvent(
  id: string,
  {
    createdAt,
    status,
    comment = null,
    authenticationUrl = null,
    channel = Channel.SOKOSUMI,
    actor,
    userId = "user-1",
    user,
    coworkerId = null,
    coworker,
    orchestratorId = null,
    orchestrator,
    credits = null,
    transactionId = null,
  }: {
    createdAt: string;
    status: TaskStatus | null;
    comment?: string | null;
    authenticationUrl?: string | null;
    channel?: Channel;
    actor?: TaskEvent["actor"];
    userId?: string | null;
    user?: TaskEvent["user"];
    coworkerId?: string | null;
    coworker?: TaskEvent["coworker"];
    orchestratorId?: string | null;
    orchestrator?: TaskEvent["orchestrator"];
    credits?: number | null;
    transactionId?: string | null;
  },
): TaskEvent {
  const resolvedActor =
    actor !== undefined
      ? actor
      : orchestratorId && orchestrator
        ? {
            type: "orchestrator" as const,
            id: orchestratorId,
            orchestrator,
          }
        : coworkerId && coworker
          ? {
              type: "coworker" as const,
              id: coworkerId,
              coworker,
            }
          : userId && user
            ? {
                type: "user" as const,
                id: userId,
                user: {
                  id: user.id,
                  name: user.name,
                  image: user.image ?? null,
                },
              }
            : null;

  return {
    id,
    createdAt,
    updatedAt: createdAt,
    taskId: "task-1",
    status,
    comment,
    authenticationUrl,
    channel,
    origin: channel,
    actor: resolvedActor,
    userId,
    user,
    coworkerId,
    coworker,
    orchestratorId,
    orchestrator,
    transactionId,
    credits,
  } as unknown as TaskEvent;
}

const baseProps = {
  taskId: "task-1",
  title: "Activity",
  placeholder: "Write a comment...",
  attachLabel: "Attach",
  submitLabel: "Submit",
  actorCoworkerLabel: "Coworker",
  actorUserLabel: "User",
  actorOrchestratorLabel: "Orchestrator",
  actorSystemLabel: "System",
  actionCommentedLabel: "commented",
  actionUpdatedStatusLabel: "updated status",
  events: [] as TaskEvent[],
  currentUser: {
    id: "user-1",
    name: "User",
    image: null,
  },
  canComment: true,
};

describe("TaskActivitySection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getHiddenFileInput(container: HTMLElement): HTMLInputElement {
    const input = container.querySelector('input[type="file"]');

    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected a hidden file input");
    }

    return input;
  }

  function renderLatestUploadToast() {
    const renderToast = toastCustomMock.mock.calls.at(-1)?.[0];

    if (typeof renderToast !== "function") {
      throw new Error("Expected toast.custom to receive a render callback");
    }

    return render(renderToast("task-upload-toast"));
  }

  it("hides the composer in read-only mode", () => {
    render(<TaskActivitySection {...baseProps} canComment={false} />);

    expect(
      screen.queryByPlaceholderText("Write a comment..."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();
  });

  it("does not show auth button when latest status is not AUTHENTICATION_REQUIRED", () => {
    const events: TaskEvent[] = [
      createEvent("older-auth", {
        createdAt: "2026-01-01T10:00:00.000Z",
        status: TaskStatus.AUTHENTICATION_REQUIRED,
        authenticationUrl: "https://example.com/auth",
      }),
      createEvent("latest-running", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(
      screen.queryByRole("link", { name: "Authenticate" }),
    ).not.toBeInTheDocument();
  });

  it("shows auth button when latest event is AUTHENTICATION_REQUIRED", () => {
    const events: TaskEvent[] = [
      createEvent("latest-status-auth", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.AUTHENTICATION_REQUIRED,
        authenticationUrl: "https://example.com/oauth/authorize",
      }),
      createEvent("older-comment", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: null,
        comment: "Looks good",
      }),
      createEvent("older-status-running", {
        createdAt: "2026-01-01T10:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    const authLink = screen.getByRole("link", { name: "Authenticate" });
    expect(authLink).toHaveAttribute(
      "href",
      "https://example.com/oauth/authorize",
    );
    expect(screen.getAllByRole("link", { name: "Authenticate" })).toHaveLength(
      1,
    );
  });

  it("does not show auth button when latest event is a comment", () => {
    const events: TaskEvent[] = [
      createEvent("latest-comment", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Looks good",
      }),
      createEvent("older-status-auth", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: TaskStatus.AUTHENTICATION_REQUIRED,
        authenticationUrl: "https://example.com/oauth/authorize",
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(
      screen.queryByRole("link", { name: "Authenticate" }),
    ).not.toBeInTheDocument();
  });

  it("renders a status dot instead of avatar for status-only events", () => {
    const events: TaskEvent[] = [
      createEvent("latest-running", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
    ];

    render(
      <TaskActivitySection
        {...baseProps}
        events={events}
        userById={{
          "user-1": {
            name: "Alice",
            image: "https://example.com/alice.png",
          },
        }}
      />,
    );

    const dot = screen.getByTestId("status-dot-latest-running");
    expect(dot).toHaveClass("size-1.5");
    expect(dot).toHaveClass("bg-emerald-500");
    expect(
      screen.queryByRole("img", { name: "Alice" }),
    ).not.toBeInTheDocument();
  });

  it("highlights completed comment events with a stone border", () => {
    const events: TaskEvent[] = [
      createEvent("completed-with-comment", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.COMPLETED,
        comment: "Task finished successfully.",
      }),
    ];

    const { container } = render(
      <TaskActivitySection {...baseProps} events={events} />,
    );

    const row = container.querySelector(".border-stone-500\\/30");
    expect(row).toBeInTheDocument();
  });

  it("does not highlight completed status-only events", () => {
    const events: TaskEvent[] = [
      createEvent("completed-status-only", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.COMPLETED,
      }),
    ];

    const { container } = render(
      <TaskActivitySection {...baseProps} events={events} />,
    );

    expect(
      container.querySelector(".border-stone-500\\/30"),
    ).not.toBeInTheDocument();
  });

  it("renders status dots for all status-only events", () => {
    const events: TaskEvent[] = [
      createEvent("latest-complete", {
        createdAt: "2026-01-01T13:00:00.000Z",
        status: TaskStatus.COMPLETED,
      }),
      createEvent("older-running", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByTestId("status-dot-older-running")).toBeInTheDocument();
    expect(
      screen.getByTestId("status-dot-latest-complete"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Alice" }),
    ).not.toBeInTheDocument();
  });

  it("renders embedded user data without relying on current session maps", () => {
    const events: TaskEvent[] = [
      createEvent("embedded-user-comment", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Left a note",
        userId: "user-2",
        user: {
          id: "user-2",
          name: "Ada Lovelace",
          image: null,
        },
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("prefers embedded coworker data over fallback coworker maps", () => {
    const events: TaskEvent[] = [
      createEvent("embedded-coworker-comment", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "I handled this",
        userId: null,
        coworkerId: "cow-1",
        coworker: {
          id: "cow-1",
          name: "Ops Agent",
          image: null,
          slug: "ops-agent",
        },
      }),
    ];

    render(
      <TaskActivitySection
        {...baseProps}
        events={events}
        coworkerById={{
          "cow-1": {
            name: "Fallback Coworker",
            image: null,
          },
        }}
      />,
    );

    expect(screen.getByText("Ops Agent")).toBeInTheDocument();
    expect(screen.queryByText("Fallback Coworker")).not.toBeInTheDocument();
  });

  it("falls back to actor maps when embedded event actors are missing", () => {
    const events: TaskEvent[] = [
      createEvent("mapped-user-comment", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Left a note",
        userId: "user-2",
      }),
    ];

    render(
      <TaskActivitySection
        {...baseProps}
        events={events}
        userById={{
          "user-2": {
            name: "Grace Hopper",
            image: null,
          },
        }}
      />,
    );

    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
  });

  it("renders extracted file and link sources for markdown comments", () => {
    const events: TaskEvent[] = [
      createEvent("latest-comment-with-sources", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment:
          "Please check [Report](https://example.com/report.pdf) and [Docs](https://docs.example.com/article).",
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByRole("link", { name: /report\.pdf/i })).toHaveAttribute(
      "href",
      "https://example.com/report.pdf",
    );
    expect(
      screen.getByRole("link", { name: /docs\.example\.com/i }),
    ).toHaveAttribute("href", "https://docs.example.com/article");
  });

  it("renders origin app text and icon alongside action", () => {
    const events: TaskEvent[] = [
      createEvent("latest-sokosumi", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Posted in app",
        channel: Channel.SOKOSUMI,
      }),
      createEvent("older-email", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: null,
        comment: "Sent by email",
        channel: Channel.EMAIL,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("from Sokosumi")).toBeInTheDocument();
    expect(screen.getByText("from Email")).toBeInTheDocument();
    expect(screen.getByLabelText("from Sokosumi")).toBeInTheDocument();
    expect(screen.getByLabelText("from Email")).toBeInTheDocument();
  });

  it("uses charged credits as action for credit-only settled events", () => {
    const events: TaskEvent[] = [
      createEvent("credit-only-settled", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        credits: 5,
        transactionId: "txn_1",
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("charged 5 credits")).toBeInTheDocument();
    expect(screen.getAllByText("charged 5 credits")).toHaveLength(1);
    expect(screen.queryByText("updated status")).not.toBeInTheDocument();
  });

  it("shows tried to charge for pause events with credits and no transaction", () => {
    const events: TaskEvent[] = [
      createEvent("pause-charge-attempt", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.OUT_OF_CREDITS,
        credits: 3,
        transactionId: null,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("updated status")).toBeInTheDocument();
    expect(screen.getByText("tried to charge 3 credits")).toBeInTheDocument();
  });

  it("shows charged line under comment when both comment and charge are present", () => {
    const events: TaskEvent[] = [
      createEvent("comment-with-charge", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Shared update",
        credits: 2,
        transactionId: "txn_2",
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("commented")).toBeInTheDocument();
    expect(screen.getByText("Shared update")).toBeInTheDocument();
    expect(screen.getByText("charged 2 credits")).toBeInTheDocument();
  });

  it("shows orchestrator actor name with owner and orb for orchestrator-authored events", () => {
    const events: TaskEvent[] = [
      createEvent("orch-event", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Assistant update",
        userId: null,
        coworkerId: null,
        orchestratorId: "orch-1",
        orchestrator: {
          id: "orch-1",
          name: "Hermes",
          avatarSeed: "orb:jewel-sky:user_123",
          owner: {
            id: "user-1",
            name: "Ada Lovelace",
            image: null,
          },
        },
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("Hermes · Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-orb")).toHaveAttribute(
      "data-seed",
      "orb:jewel-sky:user_123",
    );
    expect(screen.getByTestId("assistant-orb")).toHaveAttribute(
      "data-animate",
      "false",
    );
  });

  it("shows static placeholder orb when orchestrator avatarSeed is null", () => {
    const events: TaskEvent[] = [
      createEvent("orch-null-seed", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: null,
        comment: "Unnamed orb update",
        userId: null,
        coworkerId: null,
        orchestratorId: "orch-1",
        orchestrator: {
          id: "orch-1",
          name: "Hermes",
          avatarSeed: null,
          owner: {
            id: "user-1",
            name: "Ada Lovelace",
            image: null,
          },
        },
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("Hermes · Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-orb")).toHaveAttribute(
      "data-seed",
      "",
    );
    expect(screen.getByTestId("assistant-orb")).toHaveAttribute(
      "data-animate",
      "false",
    );
    expect(screen.queryByText("HL")).not.toBeInTheDocument();
  });

  it("prefers nested actor over conflicting deprecated flat FKs", () => {
    const events: TaskEvent[] = [
      createEvent("nested-actor-wins", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.READY,
        actor: {
          type: "orchestrator",
          id: "orch-1",
          orchestrator: {
            id: "orch-1",
            name: "Hermes",
            avatarSeed: "orb:jewel-sky:user_123",
            owner: {
              id: "user-1",
              name: "Ada Lovelace",
              image: null,
            },
          },
        },
        // Legacy dual FK: flat userId would have won the old coworker>user>orch order.
        userId: "user-2",
        user: {
          id: "user-2",
          name: "Grace Hopper",
          image: null,
        },
        coworkerId: null,
        orchestratorId: "orch-1",
        orchestrator: {
          id: "orch-1",
          name: "Hermes",
          avatarSeed: "orb:jewel-sky:user_123",
          owner: {
            id: "user-1",
            name: "Ada Lovelace",
            image: null,
          },
        },
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(screen.getByText("Hermes · Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("Grace Hopper")).not.toBeInTheDocument();
  });

  it("shows upgrade plan billing CTA for latest out-of-credits event on free plan", () => {
    const events: TaskEvent[] = [
      createEvent("latest-out-of-credits", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    ];

    render(
      <TaskActivitySection {...baseProps} events={events} viewerPlan="free" />,
    );

    const cta = screen.getByRole("link", { name: "Get more credits" });
    expect(cta).toHaveAttribute("href", "/billing?tab=subscription");
    expect(
      screen.getByText(
        "This task needs credits to continue. Open billing to proceed.",
      ),
    ).toBeInTheDocument();
  });

  it("shows add-credits billing CTA for latest out-of-credits event on paid plan", () => {
    const events: TaskEvent[] = [
      createEvent("latest-out-of-credits", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    ];

    render(
      <TaskActivitySection {...baseProps} events={events} viewerPlan="pro" />,
    );

    const cta = screen.getByRole("link", { name: "Add credits" });
    expect(cta).toHaveAttribute("href", "/billing?tab=credits");
  });

  it("shows out-of-credits status without billing CTA when plan is unavailable", () => {
    const events: TaskEvent[] = [
      createEvent("latest-out-of-credits", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    ];

    render(
      <TaskActivitySection {...baseProps} events={events} viewerPlan={null} />,
    );

    expect(
      screen.getByText("This task is out of credits."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This task needs credits to continue. Open billing to proceed.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Get more credits" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add credits" }),
    ).not.toBeInTheDocument();
  });

  it("does not show billing CTA for latest credits-topped-up event", () => {
    const events: TaskEvent[] = [
      createEvent("latest-credits-topped-up", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.CREDITS_TOPPED_UP,
      }),
    ];

    render(
      <TaskActivitySection {...baseProps} events={events} viewerPlan="pro" />,
    );

    expect(
      screen.queryByRole("link", { name: "Get more credits" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add credits" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "This task needs credits to continue. Open billing to proceed.",
      ),
    ).not.toBeInTheDocument();
  });

  it("does not show billing CTA when out-of-credits event is not latest", () => {
    const events: TaskEvent[] = [
      createEvent("latest-running", {
        createdAt: "2026-01-01T12:00:00.000Z",
        status: TaskStatus.RUNNING,
      }),
      createEvent("older-out-of-credits", {
        createdAt: "2026-01-01T11:00:00.000Z",
        status: TaskStatus.OUT_OF_CREDITS,
      }),
    ];

    render(<TaskActivitySection {...baseProps} events={events} />);

    expect(
      screen.queryByRole("link", { name: "Get more credits" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add credits" }),
    ).not.toBeInTheDocument();
  });

  it("shows upload progress toasts for comment attachments", async () => {
    const user = userEvent.setup();
    const file = new File(["report"], "report.pdf", {
      type: "application/pdf",
    });
    let resolveUpload: (() => void) | null = null;

    uploadTaskAttachmentMock.mockImplementation(
      (
        _file: File,
        options?: {
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) =>
        new Promise<string>((resolve) => {
          options?.onUploadProgress?.({
            loaded: 3,
            total: 6,
            percentage: 50,
          });
          resolveUpload = () => {
            options?.onUploadProgress?.({
              loaded: 6,
              total: 6,
              percentage: 100,
            });
            resolve("https://blob.example/report.pdf");
          };
        }),
    );

    const { container } = render(
      <TaskActivitySection {...baseProps} events={[]} />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(toastCustomMock).toHaveBeenCalled();
    });

    renderLatestUploadToast();

    expect(screen.getByText("Uploading report.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("50%")).toHaveLength(2);
    expect(screen.getAllByText("3 B / 6 B")).toHaveLength(2);
    expect(toastDismissMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpload?.();
    });

    await waitFor(() => {
      expect(toastDismissMock).toHaveBeenCalledTimes(1);
    });
  });

  it("dismisses the progress toast before showing comment upload errors", async () => {
    const user = userEvent.setup();
    const file = new File(["broken"], "broken.pdf", {
      type: "application/pdf",
    });

    uploadTaskAttachmentMock.mockImplementation(
      async (
        _file: File,
        options?: {
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) => {
        options?.onUploadProgress?.({
          loaded: 3,
          total: 6,
          percentage: 50,
        });
        throw new Error("Upload broke");
      },
    );

    const { container } = render(
      <TaskActivitySection {...baseProps} events={[]} />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(toastDismissMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).toHaveBeenCalledWith("Upload broke");
    });

    expect(toastDismissMock.mock.invocationCallOrder[0]).toBeLessThan(
      toastErrorMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("shows the custom cancel toast when in-progress comment uploads abort on unmount", async () => {
    const user = userEvent.setup();
    const file = new File(["report"], "report.pdf", {
      type: "application/pdf",
    });
    let abortSignal: AbortSignal | undefined;

    uploadTaskAttachmentMock.mockImplementation(
      (
        _file: File,
        options?: {
          abortSignal?: AbortSignal;
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) =>
        new Promise<string>((_resolve, reject) => {
          abortSignal = options?.abortSignal;
          options?.onUploadProgress?.({
            loaded: 3,
            total: 6,
            percentage: 50,
          });

          options?.abortSignal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Upload canceled.", "AbortError"));
            },
            { once: true },
          );
        }),
    );

    const { container, unmount } = render(
      <TaskActivitySection {...baseProps} events={[]} />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(uploadTaskAttachmentMock).toHaveBeenCalledTimes(1);
      expect(abortSignal).toBeDefined();
    });

    await act(async () => {
      unmount();
    });

    await waitFor(() => {
      expect(abortSignal?.aborted).toBe(true);
      expect(toastDismissMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).toHaveBeenCalledWith("Upload canceled.");
    });
  });
});
