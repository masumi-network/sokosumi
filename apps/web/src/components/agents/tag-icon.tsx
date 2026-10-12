"use client";

import {
  Aws,
  Claude,
  Cohere,
  DeepSeek,
  Gemini,
  Grok,
  Meta,
  Microsoft,
  Mistral,
  OpenAI,
  Perplexity,
  Qwen,
} from "@lobehub/icons";
import type { ComponentType } from "react";

import { regionFlagKnown } from "@/lib/utils/region-flag";

// Maps a tag/model label to a canonical token that @lobehub/icons recognizes,
// so a recognized brand always renders its real mono mark. The token on the
// left is itself one of lobehub's keyword patterns (verified against the
// package's modelMappings); the regex on the right is our own, slightly broader
// gate so common spellings ("GPT", "ChatGPT", "Command R") still resolve.
// Order matters: first match wins.
const BRAND_RULES = [
  { token: "openai", match: /(gpt|chatgpt|openai|dall-?e|sora)/i },
  { token: "claude", match: /(claude|anthropic)/i },
  { token: "mistral", match: /(mistral|mixtral|codestral)/i },
  { token: "gemini", match: /(gemini|gemma|\bbard\b|\bpalm\b|google)/i },
  { token: "llama", match: /(llama|\bmeta\b)/i },
  { token: "deepseek", match: /deepseek/i },
  { token: "grok-2", match: /(grok|\bxai\b)/i },
  { token: "qwen", match: /(qwen|tongyi|alibaba)/i },
  { token: "command-r", match: /(cohere|command-?r)/i },
  { token: "sonar", match: /(perplexity|sonar|pplx)/i },
  { token: "titan", match: /(amazon|bedrock|\btitan\b)/i },
  { token: "microsoft", match: /(\bphi\b|copilot|microsoft)/i },
] as const;

type BrandToken = (typeof BRAND_RULES)[number]["token"];

interface BrandIconProps {
  size?: number;
  className?: string;
}

type BrandIcon = ComponentType<BrandIconProps>;

// Named brand components instead of ModelIcon: ModelIcon's modelMappings
// statically import every logo in @lobehub/icons (~1.6 MB client). These twelve
// are the only tokens TagIcon ever passed through.
const BRAND_ICONS = {
  openai: OpenAI,
  claude: Claude,
  mistral: Mistral,
  gemini: Gemini,
  llama: Meta,
  deepseek: DeepSeek,
  "grok-2": Grok,
  qwen: Qwen,
  "command-r": Cohere,
  sonar: Perplexity,
  titan: Aws,
  microsoft: Microsoft,
} as const satisfies Record<BrandToken, BrandIcon>;

function brandToken(tag: string): BrandToken | null {
  for (const rule of BRAND_RULES) {
    if (rule.match.test(tag)) return rule.token;
  }
  return null;
}

interface TagIconProps {
  /** Tag label, e.g. "GPT-4o", "Claude 3.5 Sonnet", "Mistral", "EU". */
  name: string;
  size?: number;
  className?: string;
}

/**
 * Standard icon for a tag chip, resolved in order:
 *   1. recognized AI brand  → @lobehub/icons mono mark
 *   2. known region         → flag emoji
 *   3. otherwise            → nothing (text-only chip)
 * Shared by the agents gallery, agent-detail tags, and the New Task picker so
 * every tag chip renders icons identically.
 */
export function TagIcon({ name, size = 12, className }: TagIconProps) {
  const token = brandToken(name);
  if (token) {
    const Icon = BRAND_ICONS[token];
    return <Icon size={size} className={className} />;
  }

  const flag = regionFlagKnown(name);
  if (flag) {
    return (
      <span aria-hidden className={className}>
        {flag}
      </span>
    );
  }

  return null;
}
