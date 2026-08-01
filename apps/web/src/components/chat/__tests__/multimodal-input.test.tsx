import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type UIMessage } from "ai";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeDraftKey,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";
import type {
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  Coworker,
} from "@/app/chat/utils/types";

import CoworkerSelector from "../coworker-selector";
import { MultimodalInput } from "../multimodal-input";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (values?.coworkerSlug != null) {
      return `${key}:${values.coworkerSlug}`;
    }
    return key;
  },
}));

vi.mock("@/components/agents/coworker-gallery-card", () => ({
  CoworkerGalleryCard: () => null,
}));

vi.mock("../coworker-selector", () => ({
  default: vi.fn(() => null),
}));

const elenaCoworker: Coworker = {
  id: "elena",
  slug: "elena",
  name: "Elena",
  description: "",
  useCase: "",
  capabilities: ["chat", "tasks"],
  archivedAt: null,
  isWhitelisted: true,
  canChat: true,
};

function WelcomeMultimodalInput({
  onSendMessage,
}: {
  onSendMessage?: (
    message: ChatComposeMessage,
    coworker?: Coworker,
    options?: ChatComposeSubmitOptions,
  ) => boolean | Promise<boolean>;
}) {
  const [input, setInput] = useState("");

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
      coworkers={[elenaCoworker]}
      coworker={elenaCoworker}
    />
  );
}

function TestMultimodalInput({
  persistentImageGeneration = false,
  onSendMessage,
}: {
  persistentImageGeneration?: boolean;
  onSendMessage: (
    message: ChatComposeMessage,
    coworker?: Coworker,
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
    vi.mocked(CoworkerSelector).mockClear();
  });

  it("hides coworker selector on open threads", () => {
    render(
      <MultimodalInput
        chatId="conversation-1"
        input=""
        setInput={() => {}}
        status="ready"
        stop={() => {}}
        messages={[]}
        setMessages={() => {}}
        sendMessage={() => Promise.resolve()}
        selectedModel={{ id: "gpt-5-4", name: "GPT-5.4" }}
      />,
    );

    expect(CoworkerSelector).not.toHaveBeenCalled();
  });

  it("uses model name in placeholder on open model threads and does not pass a coworker on send", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(true);

    render(
      <MultimodalInput
        chatId="conversation-1"
        input="Hello model"
        setInput={() => {}}
        status="ready"
        stop={() => {}}
        messages={[]}
        setMessages={() => {}}
        sendMessage={() => Promise.resolve()}
        onSendMessage={onSendMessage}
        selectedModel={{ id: "gpt-5-4", name: "GPT-5.4" }}
        coworkers={[elenaCoworker]}
      />,
    );

    expect(
      screen.getByPlaceholderText("welcomeScreen.placeholder:GPT-5.4"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalled();
    });
    expect(onSendMessage.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("does not render compose-kind toggle on welcome composer", () => {
    render(<WelcomeMultimodalInput />);

    expect(screen.queryByRole("radio", { name: "composeChat" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "composeTask" })).toBeNull();
  });

  it("blocks welcome send when no coworker is selected", () => {
    const onSendMessage = vi.fn().mockResolvedValue(true);

    render(
      <MultimodalInput
        input="Hello"
        setInput={() => {}}
        status="ready"
        stop={() => {}}
        messages={[]}
        setMessages={() => {}}
        sendMessage={() => Promise.resolve()}
        onSendMessage={onSendMessage}
        coworkers={[]}
      />,
    );

    expect(screen.getByTestId("send-button")).toBeDisabled();

    fireEvent.click(screen.getByTestId("send-button"));

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("blocks welcome send when only a legacy model is selected", () => {
    const onSendMessage = vi.fn().mockResolvedValue(true);

    render(
      <MultimodalInput
        input="Hello"
        setInput={() => {}}
        status="ready"
        stop={() => {}}
        messages={[]}
        setMessages={() => {}}
        sendMessage={() => Promise.resolve()}
        onSendMessage={onSendMessage}
        coworkers={[]}
        selectedModel={{ id: "gpt-5-4", name: "GPT-5.4" }}
      />,
    );

    expect(screen.getByTestId("send-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("send-button"));
    expect(onSendMessage).not.toHaveBeenCalled();
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
      expect.objectContaining({
        kind: "chat",
        imageGeneration: true,
      }),
    );
  });

  it("hydrates welcome draft from localStorage and clears it on successful send", async () => {
    setComposeDraft(composeDraftKey.welcome(), {
      text: "restored draft",
      attachments: [],
    });

    const onSendMessage = vi.fn().mockResolvedValue(true);
    render(<WelcomeMultimodalInput onSendMessage={onSendMessage} />);

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("restored draft");
    });

    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(composeDraftKey.welcome())).toBeNull();
  });
});
