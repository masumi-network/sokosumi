"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { CusoMessage } from "../lib/chat-messages";

const POLL_MS = 4_000;

interface CusoChatProps {
  initialMessages: CusoMessage[];
  loadMessages: () => Promise<CusoMessage[]>;
  sendMessage: (content: string) => Promise<void>;
}

/**
 * The chat with Cuso. CMO has no realtime connection of its own, so it polls
 * Core for new messages while the page is open.
 */
export function CusoChat({
  initialMessages,
  loadMessages,
  sendMessage,
}: CusoChatProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadMessages()
        .then(setMessages)
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    startTransition(async () => {
      await sendMessage(content);
      setMessages(await loadMessages());
    });
  }

  return (
    <section className="stack chat">
      <h2>Chat with Cuso</h2>
      <div className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="note">Cuso is getting to know your business.</p>
        ) : null}
        {messages.map((message) => (
          <article
            key={message.id}
            className={message.fromCuso ? "message cuso" : "message you"}
          >
            <span className="note">{message.fromCuso ? "Cuso" : "You"}</span>
            <p>{message.content}</p>
          </article>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={onSubmit} className="composer">
        <textarea
          aria-label="Message Cuso"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Post this today, change the plan, ask anything"
        />
        <button type="submit" disabled={pending || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
