import {
  filterNormalizedMentions,
  getActiveChannelTrigger,
  getActiveEmojiTrigger,
  getActiveTrigger,
} from "@/components/ui/mention-textarea-utils";
import {
  EMOJI_RESULT_CAP,
  type EmojiShortcodeMatch,
  filterEmojiShortcodes,
} from "@/lib/utils/emoji-shortcodes";

export interface ComposerChannelOption {
  id: string;
  name: string;
  slug: string;
  organizationName: string | null;
}

export type ComposerSuggestion =
  | {
      kind: "mention";
      query: string;
      triggerStart: number;
    }
  | {
      kind: "channel";
      query: string;
      triggerStart: number;
      matches: ComposerChannelOption[];
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
  /** Membership-visible Channels for the `#` picker. */
  channels?: readonly ComposerChannelOption[];
}

/**
 * Which autocomplete (if any) is active at caret.
 * Mutual exclusion: mention first, then channel, else emoji.
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

  const channels = context.channels;
  if (channels && channels.length > 0) {
    const channelTrigger = getActiveChannelTrigger(text, caret);
    if (channelTrigger) {
      const matches = filterNormalizedMentions(
        channels.map((channel) => ({
          key: channel.id,
          value: channel.name,
          slug: channel.slug,
          data: channel,
        })),
        channelTrigger.query,
      ).flatMap((item) => (item.data ? [item.data] : []));
      if (matches.length > 0) {
        return {
          kind: "channel",
          query: channelTrigger.query,
          triggerStart: channelTrigger.triggerStart,
          matches,
        };
      }
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
