import { useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import {
  CHAT_WORK_NOUN,
  CHAT_WORK_WAIT,
  type ChatTable,
  type ChatWork,
  type ChatWorkMedia,
  isMedia,
  statusLine,
  waitingNote,
} from "../../lib/chat-work";
import { DraftText } from "../draft-text";

interface MadeInChatProps {
  work: ChatWork;
  /** Puts words in the composer: another try, or an answer. */
  compose: (text: string) => void;
  /** The full words of a file or a result, read inside the chat. */
  loadText: (id: string) => Promise<string | null>;
  /** All of a table's rows, shown inside the chat. */
  loadTable: (id: string) => Promise<ChatTable | null>;
}

/**
 * What Cuso makes or hands on in the chat, where he started it. A picture,
 * video or voice-over is a frame that says it is being made, then the file
 * itself. A file he wrote, and work he gave a Coworker or a hired Agent, is a
 * card that says where it stands and opens its words in place. The app's poll
 * moves each one on, so the owner never reloads or leaves the chat.
 */
export function MadeInChat(props: MadeInChatProps) {
  const { work } = props;
  if (isMedia(work)) return <MadeMedia work={work} compose={props.compose} />;
  if (work.kind === "table" && work.table)
    return (
      <MadeTable work={work} table={work.table} loadTable={props.loadTable} />
    );
  if (work.kind === "contacts") return <MadeContacts work={work} />;
  return <MadeWords {...props} />;
}

/**
 * A table Cuso made or filled: its first rows, and all of them in place.
 */
function MadeTable({
  work,
  table,
  loadTable,
}: {
  work: ChatWork;
  table: ChatTable;
  loadTable: MadeInChatProps["loadTable"];
}) {
  const [all, setAll] = useState<ChatTable | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, startLoading] = useTransition();
  const shown = all ?? table;
  const hidden = shown.total - shown.rows.length;
  return (
    <div className="made made-words made-table">
      <p className="made-title">{work.title}</p>
      <div className="seo-table-wrap">
        <table className="seo-table">
          <thead>
            <tr>
              {shown.columns.map((column, index) => (
                <th key={index} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.rows.map((row, line) => (
              <tr key={line}>
                {shown.columns.map((_, index) => (
                  <td key={index}>{row[index] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {shown.total === 0
          ? "No rows yet."
          : hidden > 0
            ? `${shown.rows.length} of ${shown.total} rows`
            : `${shown.total} ${shown.total === 1 ? "row" : "rows"}`}
      </p>
      {missing ? (
        <p className="note" role="alert">
          I couldn't open it. Try again in a moment.
        </p>
      ) : null}
      <div className="made-acts">
        {all === null && work.readable ? (
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={loading}
            onClick={() =>
              startLoading(async () => {
                const full = await loadTable(work.id).catch(() => null);
                setAll(full);
                setMissing(full === null);
              })
            }
          >
            {loading ? "Opening…" : "Show all"}
          </button>
        ) : null}
        {all !== null ? (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => setAll(null)}
          >
            Show less
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A contact list Cuso keeps, or the people he looked up. */
function MadeContacts({ work }: { work: ChatWork }) {
  const more = (work.total ?? work.people.length) - work.people.length;
  return (
    <div className="made made-words">
      <p className="made-title">{work.title}</p>
      {work.people.length > 0 ? (
        <ul className="made-people">
          {work.people.map((person, index) => (
            <li key={index}>
              <span>{person.name}</span>
              {person.detail ? (
                <span className="note">{person.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">Nobody on it yet.</p>
      )}
      {more > 0 ? <p className="note">and {more} more</p> : null}
    </div>
  );
}

function MadeMedia({
  work,
  compose,
}: {
  work: ChatWorkMedia;
  compose: (text: string) => void;
}) {
  const noun = CHAT_WORK_NOUN[work.kind];
  if (work.state === "ready" && work.url) {
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
        <Download url={work.url} />
      </div>
    );
  }
  if (work.state === "making") {
    return (
      <div className="made">
        <div className="made-frame" role="status">
          <p className="working-step">
            <Dots />
            <span>Making your {noun}</span>
          </p>
          <p className="note">
            {CHAT_WORK_WAIT[work.kind]} It shows up here when it is ready.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="made">
      <div className="made-frame">
        <p className="working-step">This {noun} didn't work out.</p>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => compose(`Make that ${noun} again`)}
        >
          Ask {AGENT_NAME} to try again
        </button>
      </div>
    </div>
  );
}

/**
 * A file Cuso wrote, work he handed on, a background run or a question to a
 * Coworker: where it stands, and its words.
 */
function MadeWords({
  work,
  compose,
  loadText,
}: Omit<MadeInChatProps, "loadTable">) {
  const [words, setWords] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, startLoading] = useTransition();
  const file = work.kind === "file";
  const read = () =>
    startLoading(async () => {
      const text = await loadText(work.id).catch(() => null);
      setWords(text);
      setMissing(text === null);
    });
  return (
    <div className="made made-words">
      <p
        className="working-step"
        role={work.state === "making" ? "status" : undefined}
      >
        {work.state === "making" ? <Dots /> : null}
        <span>{file ? work.title : statusLine(work)}</span>
      </p>
      {file ? null : <p className="made-title">{work.title}</p>}
      {work.steps.length > 0 ? (
        <div className="steps">
          {work.steps.map((step, index) => (
            <div
              key={index}
              className={
                step.state === "done"
                  ? "step ok"
                  : step.state === "now"
                    ? "step run"
                    : "step"
              }
            >
              <span className="dot" aria-hidden="true" />
              {step.label}
            </div>
          ))}
        </div>
      ) : null}
      {work.state === "making" ? (
        <p className="note">{waitingNote(work)}</p>
      ) : null}
      {work.text && words === null ? (
        <p className="made-text">{work.text}</p>
      ) : null}
      {words !== null ? (
        <div className="made-read">
          <DraftText text={words} title={work.title} />
        </div>
      ) : null}
      {missing ? (
        <p className="note" role="alert">
          I couldn't open it. Try again in a moment.
        </p>
      ) : null}
      {work.files.length > 0 ? (
        <ul className="made-files">
          {work.files.map((item) => (
            <li key={item.url}>
              <a href={item.url} target="_blank" rel="noreferrer" download>
                {item.name}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="made-acts">
        {work.readable && words === null ? (
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={loading}
            onClick={read}
          >
            {loading ? "Opening…" : "Read it"}
          </button>
        ) : null}
        {words !== null ? (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => setWords(null)}
          >
            Close
          </button>
        ) : null}
        {work.state === "waiting" ? (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => compose(`About "${work.title}": `)}
          >
            Answer
          </button>
        ) : null}
        {work.state === "making" && work.kind === "run" ? (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => compose(`Stop "${work.title}"`)}
          >
            Stop it
          </button>
        ) : null}
        {work.state === "failed" && !file && work.kind !== "audit" ? (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() =>
              compose(
                work.kind === "seo"
                  ? `Check again: ${work.title.toLowerCase()}`
                  : `Try "${work.title}" again`,
              )
            }
          >
            Ask {AGENT_NAME} to try again
          </button>
        ) : null}
        {file && work.url ? <Download url={work.url} /> : null}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="typing" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Download({ url }: { url: string }) {
  return (
    <a
      className="button button-ghost button-small"
      href={url}
      target="_blank"
      rel="noreferrer"
      download
    >
      Download
    </a>
  );
}
