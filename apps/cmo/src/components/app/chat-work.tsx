import { AGENT_NAME } from "../../lib/agent";
import {
  CHAT_WORK_NOUN,
  CHAT_WORK_WAIT,
  type ChatWork,
} from "../../lib/chat-work";

/**
 * What Cuso makes in the chat, where he started it: a frame that says it is
 * being made, then the picture, video or voice-over itself. The app's poll
 * swaps one for the other, so the owner never reloads or leaves the chat.
 */
export function MadeInChat({
  work,
  retry,
}: {
  work: ChatWork;
  /** Puts a request to make it again in the composer. */
  retry: (text: string) => void;
}) {
  const noun = CHAT_WORK_NOUN[work.kind];
  if (work.state === "making") {
    return (
      <div className="made">
        <div className="made-frame" role="status">
          <p className="working-step">
            <span className="typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>Making your {noun}</span>
          </p>
          <p className="note">
            {CHAT_WORK_WAIT[work.kind]} It shows up here when it is ready.
          </p>
        </div>
      </div>
    );
  }
  if (work.state === "failed" || !work.url) {
    return (
      <div className="made">
        <div className="made-frame">
          <p className="working-step">This {noun} didn't work out.</p>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => retry(`Make that ${noun} again`)}
          >
            Ask {AGENT_NAME} to try again
          </button>
        </div>
      </div>
    );
  }
  const label = `${noun[0]?.toUpperCase()}${noun.slice(1)} by ${AGENT_NAME}: ${work.title}`;
  return (
    <div className="made">
      {work.kind === "image" ? (
        <img className="made-media" src={work.url} alt={label} />
      ) : work.kind === "video" ? (
        <video
          className="made-media"
          src={work.url}
          controls
          playsInline
          preload="metadata"
          aria-label={label}
        />
      ) : (
        <audio
          className="made-audio"
          src={work.url}
          controls
          preload="metadata"
          aria-label={label}
        />
      )}
      <a
        className="button button-ghost button-small"
        href={work.url}
        target="_blank"
        rel="noreferrer"
        download
      >
        Download
      </a>
    </div>
  );
}
