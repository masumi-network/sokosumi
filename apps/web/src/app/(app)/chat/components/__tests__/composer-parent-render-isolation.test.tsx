import { fireEvent, render, screen } from "@testing-library/react";
import { memo, useRef, useState } from "react";
import { describe, expect, it } from "vitest";

/**
 * Reproduces the RoomsClient INP shape: composer markdown state at a parent
 * that also renders a heavy message list. Baseline must re-render messages on
 * each keystroke; the isolated child-state shape must not.
 */

function HeavyMessageList({
  messages,
  onRender,
}: {
  messages: string[];
  onRender: () => void;
}) {
  onRender();
  return (
    <ul>
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

const MemoHeavyMessageList = memo(HeavyMessageList);

function CoupledComposerParent({
  messages,
  onMessageListRender,
}: {
  messages: string[];
  onMessageListRender: () => void;
}) {
  const [composerValue, setComposerValue] = useState("");
  return (
    <div>
      <HeavyMessageList messages={messages} onRender={onMessageListRender} />
      <textarea
        aria-label="composer"
        value={composerValue}
        onChange={(event) => setComposerValue(event.target.value)}
      />
    </div>
  );
}

function IsolatedComposer({
  onValueChange,
}: {
  onValueChange: (value: string) => void;
}) {
  const [composerValue, setComposerValue] = useState("");
  return (
    <textarea
      aria-label="composer"
      value={composerValue}
      onChange={(event) => {
        const next = event.target.value;
        setComposerValue(next);
        onValueChange(next);
      }}
    />
  );
}

function IsolatedComposerParent({
  messages,
  onMessageListRender,
}: {
  messages: string[];
  onMessageListRender: () => void;
}) {
  // Parent keeps a ref for send/draft; typing state lives in the child.
  const composerValueRef = useRef("");
  return (
    <div>
      <MemoHeavyMessageList
        messages={messages}
        onRender={onMessageListRender}
      />
      <IsolatedComposer
        onValueChange={(value) => {
          composerValueRef.current = value;
        }}
      />
    </div>
  );
}

describe("composer parent render isolation", () => {
  const messages = Array.from({ length: 40 }, (_, index) => `message-${index}`);

  it("coupled parent re-renders the message list on each keystroke", () => {
    let messageListRenders = 0;
    render(
      <CoupledComposerParent
        messages={messages}
        onMessageListRender={() => {
          messageListRenders += 1;
        }}
      />,
    );
    const rendersAfterMount = messageListRenders;
    fireEvent.change(screen.getByLabelText("composer"), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByLabelText("composer"), {
      target: { value: "ab" },
    });
    expect(messageListRenders - rendersAfterMount).toBe(2);
  });

  it("isolated composer state does not re-render the message list on keystrokes", () => {
    let messageListRenders = 0;
    render(
      <IsolatedComposerParent
        messages={messages}
        onMessageListRender={() => {
          messageListRenders += 1;
        }}
      />,
    );
    const rendersAfterMount = messageListRenders;
    fireEvent.change(screen.getByLabelText("composer"), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByLabelText("composer"), {
      target: { value: "ab" },
    });
    expect(messageListRenders - rendersAfterMount).toBe(0);
  });
});
