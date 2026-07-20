import { ArrowDown, Loader2 } from "lucide-react";
import type { FormEvent } from "react";

import { Composer } from "./composer";

interface ComposerSectionProps {
  atBottom: boolean;
  isEmpty: boolean;
  isTransitioning: boolean;
  isReplying: boolean;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onScrollToBottom: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  attachLabel: string;
  jumpToLatestLabel: string;
  transitioningLabel: string;
  transitioningHintLabel: string;
}

export function ComposerSection({
  atBottom,
  isEmpty,
  isTransitioning,
  isReplying,
  input,
  setInput,
  files,
  setFiles,
  onSubmit,
  onStop,
  onScrollToBottom,
  composerRef,
  placeholder,
  sendLabel,
  stopLabel,
  attachLabel,
  jumpToLatestLabel,
  transitioningLabel,
  transitioningHintLabel,
}: ComposerSectionProps) {
  return (
    <div className="bg-background relative mx-auto flex w-full shrink-0 flex-col items-center px-4 pt-2 pb-4">
      {/* Soft fade from scroll area into composer */}
      <div
        aria-hidden
        className="from-background pointer-events-none absolute -top-8 right-0 left-0 z-5 h-8 bg-linear-to-t to-transparent"
      />
      {/* Jump-to-latest pill — appears when scrolled up; anchored just
          above the composer (not floating mid-chat). Border + arrow do
          the work; no shadow, matching the rest of the app. */}
      {!atBottom && !isEmpty ? (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="bg-background text-foreground border-border hover:bg-muted/60 hover:border-foreground/30 focus-visible:ring-primary/40 absolute -top-11 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2"
        >
          <ArrowDown aria-hidden className="size-3.5" />
          {jumpToLatestLabel}
        </button>
      ) : null}
      {isTransitioning ? (
        <div className="mb-2 w-full max-w-4xl">
          <div className="border-primary/30 bg-primary/5 text-foreground flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm">
            <Loader2
              className="text-primary size-4 shrink-0 animate-spin"
              aria-hidden
            />
            <span>
              {transitioningLabel}{" "}
              <span className="text-muted-foreground">
                {transitioningHintLabel}
              </span>
            </span>
          </div>
        </div>
      ) : null}
      <div className="w-full max-w-4xl">
        <Composer
          ref={composerRef}
          input={input}
          setInput={setInput}
          files={files}
          setFiles={setFiles}
          onSubmit={onSubmit}
          isReplying={isReplying}
          disabled={isTransitioning}
          onStop={onStop}
          placeholder={placeholder}
          sendLabel={sendLabel}
          stopLabel={stopLabel}
          attachLabel={attachLabel}
        />
      </div>
    </div>
  );
}
