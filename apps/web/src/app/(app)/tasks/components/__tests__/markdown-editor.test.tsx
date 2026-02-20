import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";

import { MarkdownEditor } from "@/app/tasks/components/markdown-editor";

describe("MarkdownEditor", () => {
  it("keeps mailto links with @ while rendering mentions", async () => {
    render(
      <MarkdownEditor
        value="[me](mailto:user@example.com)"
        onChange={jest.fn()}
        mentions={{
          "agent-1": { value: "Writer Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");

    await waitFor(() => {
      const link = editor.querySelector("a");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "mailto:user@example.com");
      expect(link).toHaveTextContent("me");
    });

    expect(editor.querySelector("span[data-mention-key]")).toBeNull();
  });

  it("renders multiple mentions when loading an existing task", async () => {
    render(
      <MarkdownEditor
        value="@agent-1:writer-agent test @agent-2:weather-agent"
        onChange={jest.fn()}
        mentions={{
          "agent-1": { value: "Writer Agent" },
          "agent-2": { value: "Weather Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");

    await waitFor(() => {
      const mentions = editor.querySelectorAll("span[data-mention-key]");
      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toHaveTextContent("@Writer Agent");
      expect(mentions[1]).toHaveTextContent("@Weather Agent");
    });
  });

  it("normalizes persisted internal mention tokens on edit", async () => {
    render(
      <MarkdownEditor
        value="@@MENTION1@@ test @@MENTION2@@"
        onChange={jest.fn()}
      />,
    );

    const editor = screen.getByRole("textbox");

    await waitFor(() => {
      const mentions = editor.querySelectorAll("span[data-mention-key]");
      expect(mentions).toHaveLength(2);
      expect(editor).not.toHaveTextContent("@@MENTION1@@");
      expect(editor).not.toHaveTextContent("@@MENTION2@@");
      expect(editor).toHaveTextContent("@unknown mention 1");
      expect(editor).toHaveTextContent("@unknown mention 2");
    });
  });

  it("keeps mention names containing replacement patterns", async () => {
    render(
      <MarkdownEditor
        value="@agent-1:price-agent"
        onChange={jest.fn()}
        mentions={{
          "agent-1": { value: "Price $& Agent" },
        }}
      />,
    );

    const editor = screen.getByRole("textbox");

    await waitFor(() => {
      const mention = editor.querySelector("span[data-mention-key='agent-1']");
      expect(mention).toHaveTextContent("@Price $& Agent");
      expect(editor).not.toHaveTextContent("@@MENTION_0@@");
    });
  });
});
