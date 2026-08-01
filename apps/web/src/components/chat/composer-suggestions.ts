import {
  getActiveEmojiTrigger,
  getActiveTrigger,
} from "@/components/ui/mention-textarea-utils";
import {
  EMOJI_RESULT_CAP,
  type EmojiShortcodeMatch,
  filterEmojiShortcodes,
} from "@/lib/utils/emoji-shortcodes";

export type ComposerSuggestion =
  | {
      kind: "mention";
      query: string;
      triggerStart: number;
    }
  | {
      kind: "emoji";
      query: string;
      triggerStart: number;
      matches: EmojiShortcodeMatch[];
    };

export interface ComposerSuggestionContext {
  /** When false, skip mention branch (no mention catalog). */
  mentionsAvailable: boolean;
}

/**
 * Which autocomplete (if any) is active at caret.
 * Mutual exclusion: mention first when catalog exists, else emoji.
 */
export function resolveComposerSuggestion(
  text: string,
  caret: number,
  context: ComposerSuggestionContext,
): ComposerSuggestion | null {
  if (context.mentionsAvailable) {
    const mention = getActiveTrigger(text, caret);
    if (mention) {
      return {
        kind: "mention",
        query: mention.query,
        triggerStart: mention.triggerStart,
      };
    }
  }

  const emojiTrigger = getActiveEmojiTrigger(text, caret);
  if (!emojiTrigger) return null;

  const matches = filterEmojiShortcodes(emojiTrigger.query, EMOJI_RESULT_CAP);
  if (matches.length === 0) return null;

  return {
    kind: "emoji",
    query: emojiTrigger.query,
    triggerStart: emojiTrigger.triggerStart,
    matches,
  };
}
