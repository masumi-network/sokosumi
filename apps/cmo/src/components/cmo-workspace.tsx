import type { CmoOverview } from "@sokosumi/core-client";

import type { CusoMessage } from "../lib/chat-messages";
import { BrandBrainEditor } from "./brand-brain-editor";
import { CusoChat } from "./cuso-chat";
import { StrategyCalendar } from "./strategy-calendar";

interface CmoWorkspaceProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  actions: {
    saveBrandBrain: (
      brandBrain: NonNullable<CmoOverview["brandBrain"]>,
    ) => Promise<void>;
    planMonth: (formData: FormData) => Promise<void>;
    setAutonomy: (formData: FormData) => Promise<void>;
    loadMessages: () => Promise<CusoMessage[]>;
    sendMessage: (content: string) => Promise<void>;
    signOut: () => Promise<void>;
  };
}

/** Where the business lives with Cuso: the brand, the plan, and the chat. */
export function CmoWorkspace({
  overview,
  messages,
  actions,
}: CmoWorkspaceProps) {
  const { brandBrain, strategy } = overview;
  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>{overview.businessName}</h1>
          <p className="note">{overview.websiteUrl}</p>
        </div>
        <form action={actions.signOut}>
          <button
            type="submit"
            className="button button-secondary button-small"
          >
            Sign out
          </button>
        </form>
      </header>

      {!overview.subscriptionActive ? (
        <p className="banner">
          Cuso drafts everything for free. Subscribe to let him schedule and
          publish for you.
        </p>
      ) : null}

      <div className="columns">
        <div className="stack">
          {brandBrain ? (
            <BrandBrainEditor
              brandBrain={brandBrain}
              save={actions.saveBrandBrain}
            />
          ) : (
            <section className="stack">
              <h2>Brand Brain</h2>
              <p className="note">
                Cuso is reading your website and learning your brand. This takes
                a few minutes.
              </p>
            </section>
          )}

          {strategy ? (
            <StrategyCalendar
              strategy={strategy}
              setAutonomy={actions.setAutonomy}
            />
          ) : brandBrain && overview.botStatus === "RUNNING" ? (
            <section className="stack">
              <h2>Your first month</h2>
              <p className="note">
                Cuso is working. The plan shows here when it is ready.
              </p>
            </section>
          ) : brandBrain ? (
            <form action={actions.planMonth} className="stack">
              <h2>Your first month</h2>
              <p className="note">
                Cuso plans a month of marketing and drafts the first week. You
                can change anything by chatting with him.
              </p>
              <label className="field">
                <span>Anything he should know</span>
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Optional: a launch, an event, a channel to skip"
                />
              </label>
              <button type="submit" className="button">
                Plan my month
              </button>
            </form>
          ) : null}
        </div>

        <CusoChat
          initialMessages={messages}
          loadMessages={actions.loadMessages}
          sendMessage={actions.sendMessage}
        />
      </div>
    </main>
  );
}
