"use server";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

import { getEnvSecrets } from "@/config/env.secrets";
import { feedService } from "@/lib/services";

interface LoadMoreFeedParams {
  jobsCursor: string | null;
  tasksCursor: string | null;
}

interface FeedSummaryInputItem {
  id: string;
  type: "job" | "task";
  title: string | null;
  displayTitle: string | null;
  previewText: string | null;
  contentMarkdown: string | null;
  activityAt: string;
  actor: {
    kind: "agent" | "coworker";
    name: string | null;
  };
}

interface GenerateFeedSummaryParams {
  items: FeedSummaryInputItem[];
}

interface FeedSummaryResponse {
  summary: string;
  bullets: string[];
}

const openrouter = createOpenRouter({
  apiKey: getEnvSecrets().OPENROUTER_DEFAULT_API_KEY,
});

function sanitizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractJsonObject(text: string): string | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function parseFeedSummary(text: string): FeedSummaryResponse | null {
  const rawJson = extractJsonObject(text);
  if (!rawJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawJson) as {
      summary?: unknown;
      bullets?: unknown;
    };
    const summary = sanitizeText(parsed.summary);
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets
          .map((entry) => sanitizeText(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [];
    if (!summary) {
      return null;
    }

    return {
      summary,
      bullets: bullets.slice(0, 5),
    };
  } catch {
    return null;
  }
}

function toPromptLines(items: FeedSummaryInputItem[]): string {
  return items
    .slice(0, 5)
    .map((item, index) => {
      const title =
        item.displayTitle?.trim() || item.title?.trim() || "Untitled";
      const preview = item.previewText?.trim() || "";
      const actor = item.actor.name?.trim() || item.actor.kind;
      const markdown =
        item.contentMarkdown?.trim().slice(0, 500).replace(/\s+/g, " ") || "";

      return [
        `Item ${index + 1}`,
        `id: ${item.id}`,
        `type: ${item.type}`,
        `actor: ${actor}`,
        `activityAt: ${item.activityAt}`,
        `title: ${title}`,
        `preview: ${preview}`,
        `content: ${markdown}`,
      ].join("\n");
    })
    .join("\n\n");
}

export async function loadMoreFeed(params: LoadMoreFeedParams) {
  return feedService.getMyFeedNextPoolPage({
    jobsCursor: params.jobsCursor,
    tasksCursor: params.tasksCursor,
    limitPerSource: 20,
  });
}

export async function generateFeedSummary(
  params: GenerateFeedSummaryParams,
): Promise<FeedSummaryResponse> {
  const sourceItems = params.items.slice(0, 5);

  if (sourceItems.length === 0) {
    return {
      summary: "",
      bullets: [],
    };
  }

  const systemPrompt = `You summarize a user's latest work feed.

Rules:
- Output ONLY valid JSON.
- JSON shape: {"summary": string, "bullets": string[]}
- "summary": one short sentence (80-120 chars).
- "bullets": exactly 5 concise insights if possible; each bullet 60-100 chars.
- Bullets should be insights, not just repeated titles.
- Match the language used in the feed items.
- Never include markdown code fences.`;

  const userPrompt = `Analyze the following latest completed feed items and produce the JSON output.

${toPromptLines(sourceItems)}`;

  try {
    const { text } = await generateText({
      model: openrouter("anthropic/claude-haiku-4.5"),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.5,
      maxOutputTokens: 500,
    });

    const parsed = parseFeedSummary(text);
    if (!parsed) {
      return {
        summary: "",
        bullets: [],
      };
    }

    return parsed;
  } catch (error) {
    console.error("Feed summary generation failed:", error);
    return {
      summary: "",
      bullets: [],
    };
  }
}
