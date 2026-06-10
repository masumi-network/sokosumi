import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type UIMessage } from "ai";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatComposeKind,
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  Coworker,
} from "@/app/chat/utils/types";

import { MultimodalInput } from "../multimodal-input";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/agents/coworker-gallery-card", () => ({
  CoworkerGalleryCard: () => null,
}));

vi.mock("../coworker-model-selector", () => ({
  default: () => null,
}));

vi.mock("@/app/tasks/components/markdown-editor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    id,
  }: {
    value: string;
    onChange: (value: string) => void;
    id?: string;
  }) => (
    <textarea
      data-testid="markdown-editor"
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const taskOnlyCoworker: Coworker = {
  id: "task-1",
  slug: "tasky",
  name: "Tasky",
  description: "",
  useCase: "",
  capabilities: ["tasks"],
};

const elenaCoworker: Coworker = {
  id: "elena",
  slug: "elena",
  name: "Elena",
  description: "",
  useCase: "",
  capabilities: ["chat", "tasks"],
};

const customCoworker: Coworker = {
  id: "custom",
  slug: "custom",
  name: "Custom",
  description: "",
  useCase: "",
  capabilities: ["chat", "tasks"],
};

const bothCapableCoworkers = [customCoworker, elenaCoworker];

function WelcomeMultimodalInput({
  onCoworkerChange,
  onSendMessage,
  initialComposeKind = "task",
  initialDesignMdAttachment = null,
}: {
  onCoworkerChange?: (coworker: Coworker | null) => void;
  onSendMessage?: (
    message: ChatComposeMessage,
    coworker?: Coworker,
    model?: { id: string; name: string },
    options?: ChatComposeSubmitOptions,
  ) => boolean | Promise<boolean>;
  initialComposeKind?: ChatComposeKind;
  initialDesignMdAttachment?: { label: string; url: string } | null;
}) {
  const [input, setInput] = useState("");
  const [composeKind, setComposeKind] =
    useState<ChatComposeKind>(initialComposeKind);

  return (
    <MultimodalInput
      input={input}
      setInput={setInput}
      status="ready"
      stop={() => {}}
      messages={[]}
      setMessages={() => {}}
      sendMessage={() => Promise.resolve()}
      onSendMessage={onSendMessage}
      controlledComposeKind={composeKind}
      onComposeKindChange={setComposeKind}
      coworkers={[taskOnlyCoworker]}
      coworker={taskOnlyCoworker}
      onCoworkerChange={onCoworkerChange}
      initialDesignMdAttachment={initialDesignMdAttachment}
    />
  );
}

function UncontrolledComposeKindInput({
  onSendMessage,
}: {
  onSendMessage: (
    message: ChatComposeMessage,
    coworker?: Coworker,
  ) => boolean | Promise<boolean>;
}) {
  const [input, setInput] = useState("");
  const [composeKind, setComposeKind] = useState<ChatComposeKind>("task");

  return (
    <>
      <button
        type="button"
        data-testid="fill-task-input"
        onClick={() => setInput("Task message")}
      >
        Fill task input
      </button>
      <MultimodalInput
        input={input}
        setInput={setInput}
        status="ready"
        stop={() => {}}
        messages={[]}
        setMessages={() => {}}
        sendMessage={() => Promise.resolve()}
        onSendMessage={onSendMessage}
        controlledComposeKind={composeKind}
        onComposeKindChange={setComposeKind}
        coworkers={bothCapableCoworkers}
      />
    </>
  );
}

function TestMultimodalInput({
  persistentImageGeneration = false,
  onSendMessage,
}: {
  persistentImageGeneration?: boolean;
  onSendMessage: (
    message: ChatComposeMessage,
    coworker?: unknown,
    model?: { id: string; name: string },
    options?: ChatComposeSubmitOptions,
  ) => boolean | Promise<boolean>;
}) {
  const [input, setInput] = useState("");

  return (
    <MultimodalInput
      chatId="conversation-1"
      input={input}
      setInput={setInput}
      status="ready"
      stop={() => {}}
      messages={[]}
      setMessages={() => {}}
      sendMessage={() => Promise.resolve()}
      onSendMessage={onSendMessage}
      selectedModel={{ id: "gpt-5-4", name: "GPT-5.4" }}
      persistentImageGeneration={persistentImageGeneration}
    />
  );
}

describe("MultimodalInput", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("notifies parent with null when switching to chat without chat-capable coworkers", () => {
    const onCoworkerChange = vi.fn();

    render(
      <WelcomeMultimodalInput
        initialComposeKind="task"
        onCoworkerChange={onCoworkerChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "composeChat" }));

    expect(onCoworkerChange).toHaveBeenCalledWith(null);
  });

  it("preserves manual coworker selection across compose-kind toggles without prop coworker", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(true);

    render(<UncontrolledComposeKindInput onSendMessage={onSendMessage} />);

    const avatarButtons = screen
      .getAllByRole("button")
      .filter((button) => button.className.includes("cursor-pointer"));
    fireEvent.click(avatarButtons[0]!);

    fireEvent.click(screen.getByRole("radio", { name: "composeChat" }));
    fireEvent.click(screen.getByRole("radio", { name: "composeTask" }));

    fireEvent.click(screen.getByTestId("fill-task-input"));
    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalled();
    });

    expect(onSendMessage.mock.calls[0]?.[1]).toMatchObject({
      id: "custom",
      slug: "custom",
    });
  });

  it("blocks chat send when no chat coworker or model is selected", () => {
    const onSendMessage = vi.fn().mockResolvedValue(true);

    render(
      <WelcomeMultimodalInput
        initialComposeKind="chat"
        onSendMessage={onSendMessage}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Hello" },
    });

    expect(screen.getByTestId("send-button")).toBeDisabled();

    fireEvent.click(screen.getByTestId("send-button"));

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("seeds task compose input with initial DESIGN.md attachment", async () => {
    render(
      <WelcomeMultimodalInput
        initialComposeKind="task"
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toHaveValue(
        "[DESIGN.md](https://blob.example/design.md)\n",
      );
    });
  });

  it("removes DESIGN.md from input when switching to chat mode", async () => {
    render(
      <WelcomeMultimodalInput
        initialComposeKind="task"
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toHaveValue(
        "[DESIGN.md](https://blob.example/design.md)\n",
      );
    });

    fireEvent.click(screen.getByRole("radio", { name: "composeChat" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("");
    });
  });

  it("restores DESIGN.md and keeps attachment enabled after switching task to chat and back", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(true);

    render(
      <WelcomeMultimodalInput
        initialComposeKind="task"
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
        }}
        onSendMessage={onSendMessage}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toHaveValue(
        "[DESIGN.md](https://blob.example/design.md)\n",
      );
    });

    fireEvent.click(screen.getByRole("radio", { name: "composeChat" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("");
    });

    fireEvent.click(screen.getByRole("radio", { name: "composeTask" }));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toHaveValue(
        "[DESIGN.md](https://blob.example/design.md)\n",
      );
    });

    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "[DESIGN.md](https://blob.example/design.md)",
      }),
      expect.anything(),
      undefined,
      expect.objectContaining({
        kind: "task",
        skipDesignMdAttachment: false,
      }),
    );
  });

  it("does not restore DESIGN.md after the prefilled link was removed in the editor", async () => {
    render(
      <WelcomeMultimodalInput
        initialComposeKind="task"
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toHaveValue(
        "[DESIGN.md](https://blob.example/design.md)\n",
      );
    });

    fireEvent.change(screen.getByTestId("markdown-editor"), {
      target: { value: "Build landing page" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "composeChat" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("Build landing page");
    });

    fireEvent.click(screen.getByRole("radio", { name: "composeTask" }));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-editor")).toHaveValue(
        "Build landing page",
      );
    });
  });

  it("keeps persistent image generation enabled and sends it with the message", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(true);
    render(
      <TestMultimodalInput
        persistentImageGeneration={true}
        onSendMessage={onSendMessage}
      />,
    );

    expect(screen.getByText("createImageChip.label")).toBeInTheDocument();
    expect(screen.queryByLabelText("createImageChip.remove")).toBeNull();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Make another variation" },
    });
    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ type: "text", text: "Make another variation" }],
      }) as UIMessage,
      undefined,
      { id: "gpt-5-4", name: "GPT-5.4" },
      expect.objectContaining({
        kind: "chat",
        imageGeneration: true,
      }),
    );
  });
});
