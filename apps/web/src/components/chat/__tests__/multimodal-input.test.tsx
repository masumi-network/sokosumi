import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type UIMessage } from "ai";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  ChatComposeMessage,
  ChatComposeSubmitOptions,
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
