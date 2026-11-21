"use client";

import type {
  CmoOverview,
  CmoTikTokCreator,
  TikTokPostSettings,
} from "@sokosumi/core-client";
import { Clock } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { useTikTokCreator } from "../../hooks/effects/use-tiktok-creator";
import { AGENT_NAME } from "../../lib/agent";
import { channelLabel } from "../../lib/calendar";
import { ChannelIcon } from "../channel-icon";
import { cusoArt } from "../cuso";
import { LocalStamp } from "../local-day";
import { StatusDisc } from "../status";

export type Draft = CmoOverview["drafts"][number];
type MediaItem = Draft["media"][number];

/** A change to a draft: the overview after it, or why Core refused it. */
export interface DraftResult {
  overview: CmoOverview | null;
  error: string | null;
}

/** The owner's choices and confirmation for one TikTok video. */
export type TikTokSettings = TikTokPostSettings;

/** What the owner can do with a post that waits for them. */
export interface DraftActions {
  approve: (
    postId: string,
    revision: number,
    tikTokSettings?: TikTokSettings,
  ) => Promise<string | null>;
  /** What TikTok allows on the account a waiting video goes to. */
  tikTokCreator: (
    postId: string,
  ) => Promise<{ creator: CmoTikTokCreator | null; error: string | null }>;
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

const TIKTOK_MUSIC_URL =
  "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";

/**
 * TikTok asks its creator to confirm each video, so this is the only way a
 * TikTok video goes out: the owner sees who it posts as and who can see it,
 * chooses what viewers may do, and confirms this video. Nothing is ticked
 * for them.
 */
function TikTokConfirm({
  draft,
  actions,
  pending,
  post,
}: {
  draft: Draft;
  actions: DraftActions;
  pending: boolean;
  post: (settings: TikTokSettings) => void;
}) {
  const [allow, setAllow] = useState({
    comment: false,
    duet: false,
    stitch: false,
  });
  const [confirmed, setConfirmed] = useState(false);
  const readCreator = actions.tikTokCreator;
  const { creator, error } = useTikTokCreator(draft.id, readCreator);

  if (error) {
    return (
      <p className="note" role="alert">
        {error}
      </p>
    );
  }
  if (!creator) {
    return (
      <p className="note" role="status">
        Reading your TikTok account…
      </p>
    );
  }
  const open = creator.privacy_level_options.includes("PUBLIC_TO_EVERYONE");
  if (!open) {
    return (
      <p className="note" role="alert">
        TikTok takes no more videos from {creator.creator_nickname} right now.
        Try again later.
      </p>
    );
  }
  const choices = [
    ["comment", "Allow comments", creator.comment_disabled],
    ["duet", "Allow Duet", creator.duet_disabled],
    ["stitch", "Allow Stitch", creator.stitch_disabled],
  ] as const;
  return (
    <fieldset className="tiktok-confirm" disabled={pending}>
      <legend>Post to TikTok</legend>
      <p>
        Posts as <b>{creator.creator_nickname}</b>. Everyone on TikTok can see
        it.
      </p>
      {choices.map(([key, label, off]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={allow[key] && !off}
            disabled={off}
            onChange={(event) =>
              setAllow({ ...allow, [key]: event.target.checked })
            }
          />{" "}
          {label}
          {off ? " (turned off in your TikTok settings)" : ""}
        </label>
      ))}
      <p>
        TikTok labels it as promotional content, because it promotes your own
        brand, and as made with AI when {AGENT_NAME} made the video.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{" "}
        I watched this video, read its caption and want it posted to TikTok. I
        agree to TikTok's{" "}
        <a
          className="ob-link"
          href={TIKTOK_MUSIC_URL}
          target="_blank"
          rel="noreferrer"
        >
          Music Usage Confirmation
        </a>
        .
      </label>
      <button
        type="button"
        className="button button-small"
        disabled={pending || !confirmed}
        onClick={() =>
          post({
            privacyLevel: "PUBLIC_TO_EVERYONE",
            allowComment: allow.comment && !creator.comment_disabled,
            allowDuet: allow.duet && !creator.duet_disabled,
            allowStitch: allow.stitch && !creator.stitch_disabled,
            promotesOwnBrand: true,
            acceptedMusicUsage: true,
            previewConsent: true,
          })
        }
      >
        {pending ? "Posting…" : "Post to TikTok"}
      </button>
      <span className="note">
        It goes out as soon as you post it. TikTok can take a few minutes to
        show it.
      </span>
    </fieldset>
  );
}

/**
 * A post that waits for the owner, with its picture or video: they watch it
 * and approve, rewrite or decline it right here. A TikTok video is confirmed
 * and posted in one step (`TikTokConfirm`).
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
  // The owner's yes gets its moment: Cuso's thumbs-up until the card moves on.
  const [approved, setApproved] = useState(false);
  const [text, setText] = useState(draft.text);
  const textId = useId();
  const waiting = draft.status === "NEEDS_APPROVAL";
  const tikTok = draft.provider === "tiktok";
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
      {approved ? (
        <div className="cf draft-done" role="status">
          <img
            className="draft-done-cuso"
            src={cusoArt("thumbs-up")}
            alt=""
            width={48}
            height={48}
          />
          <span>
            <b>Approved.</b>{" "}
            {draft.scheduledAt ? (
              <>
                It goes out on {network}{" "}
                <LocalStamp at={new Date(draft.scheduledAt).toISOString()} />.
              </>
            ) : (
              `It goes out on ${network} in about two minutes.`
            )}
          </span>
        </div>
      ) : editing ? (
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
          {tikTok ? (
            <TikTokConfirm
              draft={draft}
              actions={actions}
              pending={pending}
              post={(settings) =>
                run(
                  () => actions.approve(draft.id, draft.revision, settings),
                  () => setApproved(true),
                )
              }
            />
          ) : (
            <button
              type="button"
              className="button button-small"
              disabled={pending}
              onClick={() =>
                run(
                  () => actions.approve(draft.id, draft.revision),
                  () => setApproved(true),
                )
              }
            >
              {pending ? "Working…" : "Approve"}
            </button>
          )}
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
          {tikTok ? null : (
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
          )}
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
