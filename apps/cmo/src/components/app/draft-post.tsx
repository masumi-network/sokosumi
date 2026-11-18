"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Clock } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { channelLabel } from "../../lib/calendar";
import { ChannelIcon } from "../channel-icon";
import { LocalStamp } from "../local-day";
import { StatusDisc } from "../status";

export type Draft = CmoOverview["drafts"][number];
type MediaItem = Draft["media"][number];

/** A change to a draft: the overview after it, or why Core refused it. */
export interface DraftResult {
  overview: CmoOverview | null;
  error: string | null;
}

/** What the owner can do with a post Cuso made outside the month. */
export interface DraftActions {
  approve: (postId: string, revision: number) => Promise<string | null>;
  decline: (postId: string, revision: number) => Promise<string | null>;
  edit: (
    postId: string,
    revision: number,
    text: string,
  ) => Promise<string | null>;
}

/** A picture or video Cuso made, playable where it is shown. */
export function MadeMedia({ media }: { media: MediaItem }) {
  return media.kind === "video" ? (
    <video
      className="draft-media"
      src={media.url}
      controls
      playsInline
      preload="metadata"
      aria-label={`Video by ${AGENT_NAME}: ${media.name}`}
    />
  ) : (
    <img
      className="draft-media"
      src={media.url}
      alt={`Picture by ${AGENT_NAME}: ${media.name}`}
    />
  );
}

/** Where the post stands, in words beside a small mark. */
function DraftState({ draft }: { draft: Draft }) {
  const at = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
  switch (draft.status) {
    case "NEEDS_APPROVAL":
      return (
        <span className="state">
          <StatusDisc status="warn" decorative />
          Waiting for you
        </span>
      );
    case "SCHEDULED":
      return (
        <span className="state">
          <Clock size={13} aria-hidden="true" />
          Goes out {at ? <LocalStamp at={at.toISOString()} /> : "soon"}
        </span>
      );
    case "PUBLISHING":
    case "PUBLISHED":
      return (
        <span className="state">
          <StatusDisc status="ok" decorative />
          Posted
        </span>
      );
    case "CANCELED":
      return <span className="state">Declined. It won't go out.</span>;
    case "DRAFT":
      return <span className="state">Written, no time yet</span>;
    default:
      return (
        <span className="state">
          <StatusDisc status="fail" decorative />
          Didn't go out
        </span>
      );
  }
}

/**
 * A post Cuso made outside the month, with its picture or video: the owner
 * watches it and approves, rewrites or declines it right here.
 */
export function DraftPost({
  draft,
  actions,
}: {
  draft: Draft;
  actions: DraftActions;
}) {
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.text);
  const textId = useId();
  const waiting = draft.status === "NEEDS_APPROVAL";
  const network = channelLabel(draft.provider);
  const planned =
    draft.scheduledAt && new Date(draft.scheduledAt).getTime() > Date.now()
      ? new Date(draft.scheduledAt).toISOString()
      : null;

  const run = (change: () => Promise<string | null>, done?: () => void) =>
    startTransition(async () => {
      const error = await change().catch(
        () => "That didn't go through. Try again.",
      );
      setRefusal(error);
      if (!error) done?.();
    });

  return (
    <div className="card draft">
      <div className="ch">
        <ChannelIcon channel={draft.provider} size={14} />
        <b>Post for {network}</b>
        <span className="sp" />
        <DraftState draft={draft} />
      </div>
      <div className="cb">
        {draft.media.map((media) => (
          <MadeMedia key={media.url} media={media} />
        ))}
        {editing ? (
          <div className="field">
            <label htmlFor={textId}>Post text</label>
            <textarea
              id={textId}
              rows={5}
              value={text}
              disabled={pending}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
        ) : (
          <p className="txt">{draft.text}</p>
        )}
      </div>
      {editing ? (
        <div className="cf">
          <button
            type="button"
            className="button button-small"
            disabled={pending || !text.trim() || text === draft.text}
            onClick={() =>
              run(
                () => actions.edit(draft.id, draft.revision, text.trim()),
                () => setEditing(false),
              )
            }
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={pending}
            onClick={() => {
              setText(draft.text);
              setRefusal(null);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : waiting ? (
        <div className="cf">
          <button
            type="button"
            className="button button-small"
            disabled={pending}
            onClick={() => run(() => actions.approve(draft.id, draft.revision))}
          >
            {pending ? "Working…" : "Approve"}
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={pending}
            onClick={() => {
              setText(draft.text);
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={pending}
            onClick={() => run(() => actions.decline(draft.id, draft.revision))}
          >
            Decline
          </button>
          <span className="note">
            {planned ? (
              <>
                Once you approve, it goes out on {network}{" "}
                <LocalStamp at={planned} />.
              </>
            ) : (
              `It goes out on ${network} two minutes after you approve.`
            )}
          </span>
        </div>
      ) : draft.status === "SCHEDULED" ? (
        <div className="cf">
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={pending}
            onClick={() => run(() => actions.decline(draft.id, draft.revision))}
          >
            {pending ? "Stopping…" : "Don't post it"}
          </button>
        </div>
      ) : draft.publishedUrl ? (
        <div className="cf">
          <a
            className="button button-secondary button-small"
            href={draft.publishedUrl}
            target="_blank"
            rel="noreferrer"
          >
            See it on {network}
          </a>
        </div>
      ) : null}
      {refusal ? (
        <div className="cf">
          <span className="note" role="alert">
            {refusal}
          </span>
        </div>
      ) : null}
    </div>
  );
}

type Update = CmoOverview["updates"][number];

/** What a report's turn made: its posts to approve, or its pictures and videos. */
export function MadeByCuso({
  update,
  actions,
}: {
  update: Pick<Update, "posts" | "media">;
  actions: DraftActions;
}) {
  if (update.posts.length + update.media.length === 0) return null;
  return (
    <div className="stack-sm">
      {update.posts.map((draft) => (
        <DraftPost key={draft.id} draft={draft} actions={actions} />
      ))}
      {update.media.map((media) => (
        <MadeMedia key={media.url} media={media} />
      ))}
    </div>
  );
}
