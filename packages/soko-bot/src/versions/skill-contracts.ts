import { z } from "zod";
import { ACTION_LABELS } from "../action-labels.js";
import { SOKO_BOT_CAPABILITIES, type SokoBotCapability } from "../policy.js";
import {
  ACTION_RESULT_CARD_KINDS,
  ACTION_RESULT_REMOVAL_KINDS,
  CHAT_RESULT_REFERENCE_KINDS,
  type ChatResultReference,
  chatResultReferenceSchema,
  sokoBotPreviewResultInputSchema,
} from "../result-previews.js";
import {
  SOKO_BOT_TOOL_DESCRIPTIONS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "../tool-contracts.js";
import { WRITING_SKILLS } from "../writing-skills/index.js";
import {
  applyVersionCapabilities,
  CMO_SOKO_BOT_VERSION_ID,
  DEFAULT_SOKO_BOT_VERSION_ID,
  sokoBotToolDescription,
} from "./index.js";
import { SKILL_INDEX } from "./skill-index.js";
import { SOKO_BOT_SKILLS } from "./skills.js";
import type { SokoBotVersion } from "./types.js";

const ALL_CAPABILITIES: ReadonlySet<string> = new Set(SOKO_BOT_CAPABILITIES);
const CARD_KINDS: ReadonlySet<string> = new Set(CHAT_RESULT_REFERENCE_KINDS);

/**
 * Frozen historical versions whose prompt/skill text stays immutable so lab
 * history stays reproducible. Live versions (`DEFAULT_SOKO_BOT_VERSION_ID`+,
 * `CMO_SOKO_BOT_VERSION_ID`+) and any new test version are never frozen.
 */
const FROZEN_SOKO_BOT_MAX = Number(
  /^v(\d+)$/.exec(DEFAULT_SOKO_BOT_VERSION_ID)?.[1] ?? 0,
);
const FROZEN_CMO_MAX = Number(
  /^cmo-v(\d+)$/.exec(CMO_SOKO_BOT_VERSION_ID)?.[1] ?? 0,
);

export function isFrozenVersion(version: Pick<SokoBotVersion, "id">): boolean {
  if (/^cmo-v1-/.test(version.id)) return true;
  const sb = /^v(\d+)$/.exec(version.id);
  if (sb) return Number(sb[1]) < FROZEN_SOKO_BOT_MAX;
  const cmo = /^cmo-v(\d+)$/.exec(version.id);
  if (cmo) return Number(cmo[1]) < FROZEN_CMO_MAX;
  return false;
}

/**
 * Live-version contract drift catalogued when B4 / R5-B landed. Each key is
 * exact and carries the reason / follow-up; CI fails both on any unlisted
 * finding AND on any stale key left behind once a fix lands.
 */
export const KNOWN_LIVE_CONTRACT_DRIFT: Readonly<Record<string, string>> = {
  // Check 1b: v35-v37 (`messaging: "send_message"`) still reference removed
  // `post_chat` / `ask_coworker` in `result-cards` and three tool descriptions.
  "check1b:v35:skill:result-cards:post_chat":
    "result-cards names post_chat on send_message version (fix PR 2)",
  "check1b:v36:skill:result-cards:post_chat":
    "result-cards names post_chat on send_message version (fix PR 2)",
  "check1b:v37:skill:result-cards:post_chat":
    "result-cards names post_chat on send_message version (fix PR 2)",
  "check1b:v35:desc:create_schedule:post_chat":
    "create_schedule desc names post_chat on send_message version (fix PR 2)",
  "check1b:v36:desc:create_schedule:post_chat":
    "create_schedule desc names post_chat on send_message version (fix PR 2)",
  "check1b:v37:desc:create_schedule:post_chat":
    "create_schedule desc names post_chat on send_message version (fix PR 2)",
  "check1b:v35:desc:preview_result:post_chat":
    "preview_result desc names post_chat on send_message version (fix PR 2)",
  "check1b:v36:desc:preview_result:post_chat":
    "preview_result desc names post_chat on send_message version (fix PR 2)",
  "check1b:v37:desc:preview_result:post_chat":
    "preview_result desc names post_chat on send_message version (fix PR 2)",
  "check1b:v35:desc:wait_for:ask_coworker":
    "wait_for desc names ask_coworker on send_message version (fix PR 2)",
  "check1b:v36:desc:wait_for:ask_coworker":
    "wait_for desc names ask_coworker on send_message version (fix PR 2)",
  "check1b:v37:desc:wait_for:ask_coworker":
    "wait_for desc names ask_coworker on send_message version (fix PR 2)",
  "check1b:v35:desc:wait_for:post_chat":
    "wait_for desc names post_chat on send_message version (fix PR 2)",
  "check1b:v36:desc:wait_for:post_chat":
    "wait_for desc names post_chat on send_message version (fix PR 2)",
  "check1b:v37:desc:wait_for:post_chat":
    "wait_for desc names post_chat on send_message version (fix PR 2)",

  // Check 1b: cmo-v24 (`skillsOnDemand`) drops `read_writing_skill` in favor
  // of `read_skill`; skillIndexSection currently bridges the alias.
  "check1b:cmo-v24:systemPrompt:read_writing_skill":
    "cmo-v24 inherits cmo-v23 systemPrompt; skillIndexSection aliases read_writing_skill to read_skill",
  "check1b:cmo-v24:skill:cmo-production-picked:read_writing_skill":
    "shared skill uses read_writing_skill; skillIndexSection aliases it to read_skill on cmo-v24",
  "check1b:cmo-v24:skill:cmo-competitor-ads:read_writing_skill":
    "shared skill uses read_writing_skill; skillIndexSection aliases it to read_skill on cmo-v24",
  "check1b:cmo-v24:skill:cmo-newsletter:read_writing_skill":
    "shared skill uses read_writing_skill; skillIndexSection aliases it to read_skill on cmo-v24",

  // Check 1b: Cuso `cmo-code-tools` and four tool descriptions name tools Cuso
  // does not hold.
  "check1b:cmo-v23:skill:cmo-code-tools:read_email":
    "cmo-code-tools carries Soko Bot's mailbox script example (fix PR 3)",
  "check1b:cmo-v24:skill:cmo-code-tools:read_email":
    "cmo-code-tools carries Soko Bot's mailbox script example (fix PR 3)",
  "check1b:cmo-v25:skill:cmo-code-tools:read_email":
    "cmo-code-tools carries Soko Bot's mailbox script example (fix PR 3)",
  "check1b:cmo-v23:skill:cmo-code-tools:search_inbox":
    "cmo-code-tools carries Soko Bot's mailbox script example (fix PR 3)",
  "check1b:cmo-v24:skill:cmo-code-tools:search_inbox":
    "cmo-code-tools carries Soko Bot's mailbox script example (fix PR 3)",
  "check1b:cmo-v25:skill:cmo-code-tools:search_inbox":
    "cmo-code-tools carries Soko Bot's mailbox script example (fix PR 3)",
  "check1b:cmo-v23:desc:get_ad_campaign:edit_ad_campaign":
    "cusoToolDescription(get_ad_campaign) names edit_ad_campaign (fix PR 3)",
  "check1b:cmo-v24:desc:get_ad_campaign:edit_ad_campaign":
    "cusoToolDescription(get_ad_campaign) names edit_ad_campaign (fix PR 3)",
  "check1b:cmo-v25:desc:get_ad_campaign:edit_ad_campaign":
    "cusoToolDescription(get_ad_campaign) names edit_ad_campaign (fix PR 3)",
  "check1b:cmo-v23:desc:get_market_keywords:find_ad_targeting":
    "cusoToolDescription(get_market_keywords) names find_ad_targeting (fix PR 3)",
  "check1b:cmo-v24:desc:get_market_keywords:find_ad_targeting":
    "cusoToolDescription(get_market_keywords) names find_ad_targeting (fix PR 3)",
  "check1b:cmo-v25:desc:get_market_keywords:find_ad_targeting":
    "cusoToolDescription(get_market_keywords) names find_ad_targeting (fix PR 3)",
  "check1b:cmo-v23:desc:list_integration_tools:create_ad_campaign":
    "cusoToolDescription(list_integration_tools) names create_ad_campaign (fix PR 3)",
  "check1b:cmo-v24:desc:list_integration_tools:create_ad_campaign":
    "cusoToolDescription(list_integration_tools) names create_ad_campaign (fix PR 3)",
  "check1b:cmo-v25:desc:list_integration_tools:create_ad_campaign":
    "cusoToolDescription(list_integration_tools) names create_ad_campaign (fix PR 3)",
  "check1b:cmo-v23:desc:list_integration_tools:read_email":
    "cusoToolDescription(list_integration_tools) names read_email (fix PR 3)",
  "check1b:cmo-v24:desc:list_integration_tools:read_email":
    "cusoToolDescription(list_integration_tools) names read_email (fix PR 3)",
  "check1b:cmo-v25:desc:list_integration_tools:read_email":
    "cusoToolDescription(list_integration_tools) names read_email (fix PR 3)",
  "check1b:cmo-v23:desc:list_integration_tools:search_inbox":
    "cusoToolDescription(list_integration_tools) names search_inbox (fix PR 3)",
  "check1b:cmo-v24:desc:list_integration_tools:search_inbox":
    "cusoToolDescription(list_integration_tools) names search_inbox (fix PR 3)",
  "check1b:cmo-v25:desc:list_integration_tools:search_inbox":
    "cusoToolDescription(list_integration_tools) names search_inbox (fix PR 3)",
  "check1b:cmo-v23:desc:wait_for:find_integrations":
    "cusoToolDescription(wait_for) names find_integrations (fix PR 3)",
  "check1b:cmo-v24:desc:wait_for:find_integrations":
    "cusoToolDescription(wait_for) names find_integrations (fix PR 3)",
  "check1b:cmo-v25:desc:wait_for:find_integrations":
    "cusoToolDescription(wait_for) names find_integrations (fix PR 3)",

  // Check 4: Universal rules vs partial schema coverage
  "check4:result-cards-no-card-boundary:skill:result-cards":
    "result-cards does not yet state that writes outside its listed kinds have no card (fix PR 2)",
  "check4:result-cards-no-card-boundary:desc:preview_result":
    "preview_result description does not yet state that unlisted writes have no card (fix PR 2)",
  "check4:cuso-no-preview-card:skill:cmo-launch-video":
    "cmo-launch-video asks Cuso to show a preview card although Cuso lacks preview_result (fix PR 3)",
  "check4:generate-image-constraints-exposed:schema:generate_image":
    "generate_image JSON schema omits allowed aspect ratios and headline styleReferenceId rule (fix PR 2)",
};

/** Tool-like snake_case verb prefixes used to spot misspelled/removed tool names in backticks. */
const TOOL_VERB_PREFIXES: ReadonlySet<string> = new Set([
  "add",
  "archive",
  "ask",
  "assign",
  "bulk",
  "cancel",
  "check",
  "count",
  "create",
  "delete",
  "draft",
  "edit",
  "enrich",
  "evaluate",
  "export",
  "find",
  "generate",
  "get",
  "handle",
  "hire",
  "import",
  "install",
  "link",
  "list",
  "log",
  "manage",
  "merge",
  "move",
  "newsletter",
  "open",
  "post",
  "preview",
  "provide",
  "publish",
  "read",
  "record",
  "refresh",
  "remove",
  "reply",
  "report",
  "request",
  "research",
  "run",
  "save",
  "schedule",
  "search",
  "send",
  "set",
  "start",
  "stop",
  "submit",
  "sync",
  "update",
  "upload",
  "upsert",
  "wait",
  "web",
  "workspace",
  "write",
]);

interface ToolSchemaKeys {
  topKeys: ReadonlySet<string>;
  allKeys: ReadonlySet<string>;
  enumsByKey: ReadonlyMap<string, ReadonlySet<string>>;
}

function walkJsonSchema(
  node: unknown,
  allKeys: Set<string>,
  enumsByKey: Map<string, Set<string>>,
  currentKey?: string,
): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (currentKey) {
    if (Array.isArray(obj.enum)) {
      const set = enumsByKey.get(currentKey) ?? new Set<string>();
      for (const value of obj.enum)
        if (typeof value === "string") set.add(value);
      enumsByKey.set(currentKey, set);
    }
    if (typeof obj.const === "string") {
      const set = enumsByKey.get(currentKey) ?? new Set<string>();
      set.add(obj.const);
      enumsByKey.set(currentKey, set);
    }
  }
  if (obj.properties && typeof obj.properties === "object") {
    for (const [key, value] of Object.entries(
      obj.properties as Record<string, unknown>,
    )) {
      allKeys.add(key);
      walkJsonSchema(value, allKeys, enumsByKey, key);
    }
  }
  for (const branchKey of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(obj[branchKey])) {
      for (const item of obj[branchKey] as unknown[])
        walkJsonSchema(item, allKeys, enumsByKey, currentKey);
    }
  }
  if (obj.items) walkJsonSchema(obj.items, allKeys, enumsByKey, currentKey);
  if (
    obj.additionalProperties &&
    typeof obj.additionalProperties === "object"
  ) {
    walkJsonSchema(obj.additionalProperties, allKeys, enumsByKey);
  }
  if (obj.$defs && typeof obj.$defs === "object") {
    for (const value of Object.values(obj.$defs as Record<string, unknown>))
      walkJsonSchema(value, allKeys, enumsByKey);
  }
}

function buildToolSchemaIndex(): {
  byTool: Map<string, ToolSchemaKeys>;
  allKeys: Set<string>;
  allEnums: Set<string>;
} {
  const byTool = new Map<string, ToolSchemaKeys>();
  const allKeys = new Set<string>();
  const allEnums = new Set<string>();
  for (const capability of SOKO_BOT_CAPABILITIES) {
    const jsonSchema = z.toJSONSchema(SOKO_BOT_TOOL_INPUT_SCHEMAS[capability], {
      unrepresentable: "any",
    }) as Record<string, unknown>;
    const topKeys = new Set<string>();
    const collectTop = (record: Record<string, unknown>) => {
      if (record.properties && typeof record.properties === "object") {
        for (const key of Object.keys(
          record.properties as Record<string, unknown>,
        ))
          topKeys.add(key);
      }
      for (const branchKey of ["anyOf", "oneOf", "allOf"]) {
        if (Array.isArray(record[branchKey])) {
          for (const branch of record[branchKey] as Record<string, unknown>[])
            collectTop(branch);
        }
      }
    };
    collectTop(jsonSchema);
    const keys = new Set<string>();
    const enumsByKey = new Map<string, Set<string>>();
    walkJsonSchema(jsonSchema, keys, enumsByKey);
    for (const key of keys) allKeys.add(key);
    for (const enumValues of enumsByKey.values())
      for (const value of enumValues) allEnums.add(value);
    byTool.set(capability, { topKeys, allKeys: keys, enumsByKey });
  }
  return { byTool, allKeys, allEnums };
}

const TOOL_SCHEMA_INDEX = buildToolSchemaIndex();

interface CardVariantSpec {
  required: ReadonlySet<string>;
  allowed: ReadonlySet<string>;
}

function buildCardVariants(): Map<string, CardVariantSpec> {
  const variants = new Map<string, CardVariantSpec>();
  const jsonSchema = z.toJSONSchema(chatResultReferenceSchema) as {
    anyOf?: Array<{
      properties?: Record<string, { const?: string }>;
      required?: string[];
    }>;
    oneOf?: Array<{
      properties?: Record<string, { const?: string }>;
      required?: string[];
    }>;
  };
  for (const variant of jsonSchema.anyOf ?? jsonSchema.oneOf ?? []) {
    const kind = variant.properties?.kind?.const;
    if (!kind) continue;
    variants.set(kind, {
      required: new Set(variant.required ?? []),
      allowed: new Set(Object.keys(variant.properties ?? {})),
    });
  }
  return variants;
}

const CARD_VARIANTS = buildCardVariants();

export interface ContractSource {
  label: string;
  content: string;
}

export interface ContractFinding {
  /** Stable key for allowlisting known live drift and proving no stale entries. */
  key: string;
  check: "1a" | "1b" | "2a" | "2b" | "3" | "4";
  message: string;
}

/**
 * Check 1a: backticked tool-like names, `$SOKO_TOOLS_URL/<name>`, and
 * `call("<name>", ...)` must resolve to a registered `SOKO_BOT_CAPABILITIES` entry.
 */
export function checkUnknownToolNames(
  sources: readonly ContractSource[],
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const seen = new Set<string>();
  const record = (source: ContractSource, name: string, via: string) => {
    const key = `check1a:${source.label}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      key,
      check: "1a",
      message: `${source.label} names unknown tool "${name}" (${via})`,
    });
  };
  for (const source of sources) {
    for (const match of source.content.matchAll(
      /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g,
    )) {
      const name = match[1]!;
      if (
        ALL_CAPABILITIES.has(name) ||
        TOOL_SCHEMA_INDEX.allKeys.has(name) ||
        TOOL_SCHEMA_INDEX.allEnums.has(name)
      )
        continue;
      const prefix = name.split("_")[0]!;
      if (TOOL_VERB_PREFIXES.has(prefix)) record(source, name, "backticked");
    }
    for (const match of source.content.matchAll(
      /\$SOKO_TOOLS_URL\/([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g,
    )) {
      const name = match[1]!;
      if (!ALL_CAPABILITIES.has(name)) record(source, name, "$SOKO_TOOLS_URL");
    }
    for (const match of source.content.matchAll(
      /\bcall\(\s*"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"\s*,/g,
    )) {
      const name = match[1]!;
      if (!ALL_CAPABILITIES.has(name)) record(source, name, "call()");
    }
  }
  return findings;
}

/**
 * Check 1b: every registered capability named in a live (non-frozen) version's
 * system prompt, skills, skill-index entries, writing skills, or rendered tool
 * descriptions must be offered to that version (`applyVersionCapabilities`).
 */
export function checkVersionToolReferences(
  versions: readonly SokoBotVersion[],
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const seen = new Set<string>();
  const skillById = new Map(
    SOKO_BOT_SKILLS.map((skill) => [skill.id, skill.content]),
  );

  for (const version of versions) {
    if (isFrozenVersion(version)) continue;
    const offered = applyVersionCapabilities(version, SOKO_BOT_CAPABILITIES);
    const offeredSet = new Set<string>(offered);

    const texts: Array<[string, string]> = [
      ["systemPrompt", version.systemPrompt],
      ...version.skills.map((skillId): [string, string] => [
        `skill:${skillId}`,
        skillById.get(skillId) ?? "",
      ]),
      ...version.skills
        .filter((skillId) => SKILL_INDEX[skillId] !== undefined)
        .map((skillId): [string, string] => [
          `index:${skillId}`,
          SKILL_INDEX[skillId]!.useWhen,
        ]),
      ...(version.profile === "cmo"
        ? WRITING_SKILLS.map((ws): [string, string] => [
            `writing:${ws.id}`,
            ws.content,
          ])
        : []),
      ...offered.map((capability): [string, string] => [
        `desc:${capability}`,
        sokoBotToolDescription(capability, version),
      ]),
    ];

    for (const [where, content] of texts) {
      for (const match of content.matchAll(
        /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g,
      )) {
        const tool = match[1]!;
        if (!ALL_CAPABILITIES.has(tool) || offeredSet.has(tool)) continue;
        const key = `check1b:${version.id}:${where}:${tool}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          key,
          check: "1b",
          message: `${version.id} (${where}) names "${tool}", which is not offered to ${version.id}`,
        });
      }
    }
  }
  return findings;
}

/** Tools whose arguments carry `ChatResultReference` objects rather than tool-specific `kind` fields. */
const CARD_REFERENCE_TOOLS: ReadonlySet<string> = new Set([
  "preview_result",
  "post_chat",
  "send_message",
]);

interface ToolCallObjectMatch {
  tool: string;
  start: number;
  end: number;
  body: string;
}

/** Finds balanced `{...}` argument objects in `tool({...})` and `call("tool", {...})` examples. */
function findToolCallObjects(content: string): ToolCallObjectMatch[] {
  const matches: ToolCallObjectMatch[] = [];
  const opener =
    /(?:`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?\s*\(\s*\{|call\(\s*"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"\s*,\s*\{)/g;
  for (const match of content.matchAll(opener)) {
    const tool = match[1] ?? match[2]!;
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    let end = -1;
    for (let i = start; i < content.length; i += 1) {
      const ch = content[i]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > start) {
      matches.push({ tool, start, end, body: content.slice(start, end) });
    }
  }
  return matches;
}

function splitTopLevelObjectEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let current = "";
  for (let i = 1; i < body.length - 1; i += 1) {
    const ch = body[i]!;
    if (quote) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
      current += ch;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      current += ch;
    } else if (ch === "," && depth === 0) {
      if (current.trim()) entries.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) entries.push(current.trim());
  return entries;
}

/**
 * Check 2: validates every `{kind:"…", ...}` result-card reference,
 * `preview_result({...})` JSON example, JSON/object tool call example (against
 * its own schema, including enum values like `wait_for.kind`), and explicit
 * `tool` (`field: value`) / `tool` with `field` input references.
 */
export function checkCardAndFieldReferences(
  sources: readonly ContractSource[],
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const seen = new Set<string>();
  const record = (check: "2a" | "2b", key: string, message: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ key, check, message });
  };

  for (const source of sources) {
    const nonCardToolSpans: Array<readonly [number, number]> = [];

    // 2b-1: `tool_name({...})` and `call("tool_name", {...})` JSON/object examples
    for (const call of findToolCallObjects(source.content)) {
      const info = TOOL_SCHEMA_INDEX.byTool.get(call.tool);
      if (!info) continue;
      if (!CARD_REFERENCE_TOOLS.has(call.tool)) {
        nonCardToolSpans.push([call.start, call.end]);
      }
      for (const part of splitTopLevelObjectEntries(call.body)) {
        const km = /^"?([a-zA-Z][a-zA-Z0-9_]*)"?(?:\s*:\s*([\s\S]*))?$/.exec(
          part,
        );
        if (!km) continue;
        const field = km[1]!;
        const valueExpr = km[2]?.trim();
        if (!info.topKeys.has(field)) {
          record(
            "2b",
            `check2b:${source.label}:call:${call.tool}:${field}`,
            `${source.label} example ${call.tool}(...) names unknown input field "${field}"`,
          );
          continue;
        }
        const stringLiteral = valueExpr
          ? /^"([^"\\]+)"$|^'([^'\\]+)'$/.exec(valueExpr)
          : null;
        const rawValue = stringLiteral?.[1] ?? stringLiteral?.[2];
        const enums = info.enumsByKey.get(field);
        if (
          rawValue &&
          enums &&
          enums.size > 0 &&
          !/^[<]/.test(rawValue) &&
          !enums.has(rawValue)
        ) {
          record(
            "2b",
            `check2b:${source.label}:call-enum:${call.tool}:${field}:${rawValue}`,
            `${source.label} example ${call.tool}(...) uses "${rawValue}" for ${field}, not in [${[...enums].join(", ")}]`,
          );
        }
      }
    }

    // 2b-2: `$SOKO_TOOLS_URL/<tool> ... '{"input":{...}}'` curl examples
    for (const match of source.content.matchAll(
      /SOKO_TOOLS_URL\/([a-z][a-z0-9]*(?:_[a-z0-9]+)+)[^\n]*?'(\{"input":\{[^']+\}\})'/g,
    )) {
      const tool = match[1]!;
      const info = TOOL_SCHEMA_INDEX.byTool.get(tool);
      if (!info) continue;
      if (!CARD_REFERENCE_TOOLS.has(tool)) {
        nonCardToolSpans.push([match.index, match.index + match[0].length]);
      }
      try {
        const parsed = JSON.parse(match[2]!) as {
          input?: Record<string, unknown>;
        };
        for (const [field, value] of Object.entries(parsed.input ?? {})) {
          if (!info.topKeys.has(field)) {
            record(
              "2b",
              `check2b:${source.label}:curl:${tool}:${field}`,
              `${source.label} curl example for ${tool} names unknown input field "${field}"`,
            );
            continue;
          }
          const enums = info.enumsByKey.get(field);
          if (
            typeof value === "string" &&
            enums &&
            enums.size > 0 &&
            !/^[<]/.test(value) &&
            !enums.has(value)
          ) {
            record(
              "2b",
              `check2b:${source.label}:curl-enum:${tool}:${field}:${value}`,
              `${source.label} curl example for ${tool} uses "${value}" for ${field}, not in [${[...enums].join(", ")}]`,
            );
          }
        }
      } catch {
        record(
          "2b",
          `check2b:${source.label}:curl-parse:${tool}`,
          `${source.label} has unparseable curl JSON for ${tool}`,
        );
      }
    }

    const insideNonCardToolCall = (index: number): boolean =>
      nonCardToolSpans.some(([start, end]) => index >= start && index < end);

    // 2a-1: `{kind:"…", ...}` result-card references (excludes non-card tool inputs such as `wait_for`)
    for (const match of source.content.matchAll(
      /\{\s*"?kind"?\s*:\s*"([^"]+)"([^}]*)\}/g,
    )) {
      if (insideNonCardToolCall(match.index)) continue;
      const kind = match[1]!;
      const rest = match[2]!;
      const variant = CARD_VARIANTS.get(kind);
      if (!variant) {
        record(
          "2a",
          `check2a:${source.label}:unknown-kind:${kind}`,
          `${source.label} uses unknown card kind "${kind}" in ${match[0]}`,
        );
        continue;
      }
      const parts = rest
        .replace(/\[[^\]]*\]/g, "[]")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const fields = new Set<string>(["kind"]);
      for (const part of parts) {
        const keyMatch = /^"?([a-zA-Z][a-zA-Z0-9_]*)"?(?:\s*:|$)/.exec(part);
        if (keyMatch) fields.add(keyMatch[1]!);
      }
      const missing = [...variant.required].filter((req) => !fields.has(req));
      const extra = [...fields].filter((field) => !variant.allowed.has(field));
      if (missing.length || extra.length) {
        record(
          "2a",
          `check2a:${source.label}:kind-fields:${kind}:${missing.join(",")}:${extra.join(",")}`,
          `${source.label} card reference ${match[0]} mismatches "${kind}" schema (missing=[${missing.join(", ")}] extra=[${extra.join(", ")}])`,
        );
      }
    }

    // 2a-2: `preview_result({...})` JSON examples must parse strictly
    for (const match of source.content.matchAll(
      /preview_result\((\{[^\n]+?\})\)/g,
    )) {
      try {
        const parsed = JSON.parse(match[1]!);
        const result = sokoBotPreviewResultInputSchema.safeParse(parsed);
        if (!result.success) {
          record(
            "2a",
            `check2a:${source.label}:preview-json-invalid:${match[1]}`,
            `${source.label} has invalid preview_result JSON example ${match[0]}: ${result.error.issues[0]?.message ?? "invalid"}`,
          );
        }
      } catch {
        record(
          "2a",
          `check2a:${source.label}:preview-json-parse:${match[1]}`,
          `${source.label} has unparseable preview_result JSON example ${match[0]}`,
        );
      }
    }

    // 2b-3: explicit `` `tool` (`field: value`) `` or `` `tool` with `field` ``
    for (const line of source.content.split("\n")) {
      for (const match of line.matchAll(
        /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`\s*\(([^)]+)\)/g,
      )) {
        const tool = match[1]!;
        const info = TOOL_SCHEMA_INDEX.byTool.get(tool);
        if (!info) continue;
        const inside = match[2]!;
        for (const fm of inside.matchAll(
          /`([a-z][a-zA-Z0-9_]*)\s*:\s*([^`]+)`/g,
        )) {
          const field = fm[1]!;
          const rawValue = fm[2]!.trim().replace(/^["']|["']$/g, "");
          if (!info.allKeys.has(field)) {
            record(
              "2b",
              `check2b:${source.label}:paren:${tool}:${field}`,
              `${source.label} pairs ${tool} with unknown input field "${field}"`,
            );
            continue;
          }
          const enums = info.enumsByKey.get(field);
          if (
            enums &&
            enums.size > 0 &&
            !/^[[<{"']/.test(rawValue) &&
            rawValue !== "true" &&
            rawValue !== "false" &&
            !/^\d+$/.test(rawValue) &&
            !enums.has(rawValue)
          ) {
            record(
              "2b",
              `check2b:${source.label}:enum:${tool}:${field}:${rawValue}`,
              `${source.label} uses "${rawValue}" for ${tool}.${field}, not in [${[...enums].join(", ")}]`,
            );
          }
        }
      }

      for (const match of line.matchAll(
        /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`\s+(?:with|passing|setting)\s+(?:an?\s+|its\s+|their\s+|the\s+)?`([a-z][a-zA-Z0-9]*)(?:\s*:\s*([^`]+))?`/g,
      )) {
        const tool = match[1]!;
        const field = match[2]!;
        const rawValue = match[3]?.trim().replace(/^["']|["']$/g, "");
        if (ALL_CAPABILITIES.has(field)) continue;
        const info = TOOL_SCHEMA_INDEX.byTool.get(tool);
        if (!info) continue;
        if (!info.allKeys.has(field)) {
          record(
            "2b",
            `check2b:${source.label}:with:${tool}:${field}`,
            `${source.label} pairs ${tool} with unknown input field "${field}"`,
          );
          continue;
        }
        if (rawValue) {
          const enums = info.enumsByKey.get(field);
          if (
            enums &&
            enums.size > 0 &&
            !/^[[<{"']/.test(rawValue) &&
            rawValue !== "true" &&
            rawValue !== "false" &&
            !/^\d+$/.test(rawValue) &&
            !enums.has(rawValue)
          ) {
            record(
              "2b",
              `check2b:${source.label}:with-enum:${tool}:${field}:${rawValue}`,
              `${source.label} uses "${rawValue}" for ${tool}.${field}, not in [${[...enums].join(", ")}]`,
            );
          }
        }
      }
    }
  }
  return findings;
}

/**
 * Check 3: every write capability in `ACTION_LABELS` must map in
 * `ACTION_RESULT_CARD_KINDS` to either a valid `ChatResultReference["kind"]`
 * or `null` (explicit no card), with zero unmapped or orphaned keys, and
 * `ACTION_RESULT_REMOVAL_KINDS` must name only `null` (no-card) writes with
 * valid card kinds.
 */
export function checkActionCardMapping(
  actionLabels: Readonly<Record<string, string>> = ACTION_LABELS,
  cardKinds: Readonly<
    Record<string, ChatResultReference["kind"] | null>
  > = ACTION_RESULT_CARD_KINDS,
  removalKinds: Readonly<
    Record<string, ChatResultReference["kind"]>
  > = ACTION_RESULT_REMOVAL_KINDS,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  for (const capability of Object.keys(actionLabels)) {
    if (!ALL_CAPABILITIES.has(capability)) {
      findings.push({
        key: `check3:unknown-action-label:${capability}`,
        check: "3",
        message: `ACTION_LABELS entry "${capability}" is not in SOKO_BOT_CAPABILITIES`,
      });
    }
    if (!Object.hasOwn(cardKinds, capability)) {
      findings.push({
        key: `check3:missing-card-mapping:${capability}`,
        check: "3",
        message: `ACTION_LABELS write "${capability}" has neither a card kind nor an explicit null ("no card") entry in ACTION_RESULT_CARD_KINDS`,
      });
      continue;
    }
    const mapping = cardKinds[capability];
    if (mapping !== null && !CARD_KINDS.has(mapping)) {
      findings.push({
        key: `check3:invalid-card-kind:${capability}:${String(mapping)}`,
        check: "3",
        message: `ACTION_RESULT_CARD_KINDS.${capability} maps to unknown card kind "${String(mapping)}"`,
      });
    }
  }
  for (const capability of Object.keys(cardKinds)) {
    if (!(capability in actionLabels)) {
      findings.push({
        key: `check3:orphan-card-mapping:${capability}`,
        check: "3",
        message: `ACTION_RESULT_CARD_KINDS entry "${capability}" is not in ACTION_LABELS`,
      });
    }
  }
  for (const [capability, removalKind] of Object.entries(removalKinds)) {
    if (!(capability in actionLabels)) {
      findings.push({
        key: `check3:orphan-removal-mapping:${capability}`,
        check: "3",
        message: `ACTION_RESULT_REMOVAL_KINDS entry "${capability}" is not in ACTION_LABELS`,
      });
      continue;
    }
    if (cardKinds[capability] !== null) {
      findings.push({
        key: `check3:removal-must-be-no-card:${capability}`,
        check: "3",
        message: `ACTION_RESULT_REMOVAL_KINDS.${capability} must map to null in ACTION_RESULT_CARD_KINDS`,
      });
    }
    if (!CARD_KINDS.has(removalKind)) {
      findings.push({
        key: `check3:invalid-removal-card-kind:${capability}:${String(removalKind)}`,
        check: "3",
        message: `ACTION_RESULT_REMOVAL_KINDS.${capability} maps to unknown card kind "${String(removalKind)}"`,
      });
    }
  }
  return findings;
}

/**
 * Check 4: short reviewed list of universal rules vs partial schemas.
 * Keeps prose rules synchronized with the real tool/card contract without
 * brittle free-text matching.
 */
export function checkUniversalRuleContracts(
  versions: readonly SokoBotVersion[],
  options: {
    skills?: readonly { id: string; content: string }[];
    toolDescriptions?: Readonly<Record<SokoBotCapability, string>>;
    generateImageSchema?: z.ZodType;
  } = {},
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const skills = options.skills ?? SOKO_BOT_SKILLS;
  const skillById = new Map(skills.map((skill) => [skill.id, skill.content]));
  const toolDescriptions =
    options.toolDescriptions ?? SOKO_BOT_TOOL_DESCRIPTIONS;
  const generateImageSchema =
    options.generateImageSchema ?? SOKO_BOT_TOOL_INPUT_SCHEMAS.generate_image;

  const liveVersions = versions.filter((version) => !isFrozenVersion(version));
  const liveSkillIds = new Set(liveVersions.flatMap((v) => v.skills));
  const liveCmoSkillIds = new Set(
    liveVersions.filter((v) => v.profile === "cmo").flatMap((v) => v.skills),
  );

  // Rule 1: Since `ACTION_RESULT_CARD_KINDS` includes explicit `null` (no-card)
  // writes (newsletter issues, tables, contacts, projects, ads, emails), live
  // result-card skills and `preview_result` description must explicitly state
  // that items outside the listed kinds have no card.
  const hasNoCardWrites = Object.values(ACTION_RESULT_CARD_KINDS).some(
    (kind) => kind === null,
  );
  if (hasNoCardWrites) {
    // Must explicitly bound preview_result to its supported kinds for created
    // items (not merely "clarification with nothing created needs no card").
    const noCardBoundaryPattern =
      /(?:only (?:the )?(?:listed|these|supported)|items? (?:outside|without)|other (?:items?|writes?)|newsletter|tables?)[\s\S]{0,160}(?:have no (?:result )?card|has no (?:result )?card|do not call `?preview_result`?|never call `?preview_result`?)/i;
    for (const skillId of liveSkillIds) {
      if (!["result-cards", "result-cards-messaging"].includes(skillId))
        continue;
      const content = skillById.get(skillId) ?? "";
      if (!noCardBoundaryPattern.test(content)) {
        findings.push({
          key: `check4:result-cards-no-card-boundary:skill:${skillId}`,
          check: "4",
          message: `skill:${skillId} instructs preview_result after writes without stating that unlisted writes have no result card`,
        });
      }
    }
    if (!noCardBoundaryPattern.test(toolDescriptions.preview_result)) {
      findings.push({
        key: "check4:result-cards-no-card-boundary:desc:preview_result",
        check: "4",
        message:
          "preview_result tool description does not state that writes outside its reference kinds have no result card",
      });
    }
  }

  // Rule 2: No live CMO version offers `preview_result`, so no live CMO skill
  // may tell Cuso to show a preview card or call `preview_result`.
  for (const skillId of liveCmoSkillIds) {
    const content = skillById.get(skillId) ?? "";
    if (/\bpreview_result\b|\bpreview card\b/i.test(content)) {
      findings.push({
        key: `check4:cuso-no-preview-card:skill:${skillId}`,
        check: "4",
        message: `CMO skill:${skillId} mentions preview card / preview_result although Cuso versions do not offer preview_result`,
      });
    }
  }

  // Rule 3 & 4: Every live `social_post` and `studio_job` card reference must
  // include `projectId` (strictly required by `chatResultReferenceSchema`).
  for (const skillId of liveSkillIds) {
    const content = skillById.get(skillId) ?? "";
    for (const kind of ["social_post", "studio_job"] as const) {
      for (const match of content.matchAll(
        new RegExp(`\\{\\s*"?kind"?\\s*:\\s*"${kind}"[^}]*\\}`, "g"),
      )) {
        if (!/\bprojectId\b/.test(match[0])) {
          findings.push({
            key: `check4:${kind}-requires-project-id:skill:${skillId}`,
            check: "4",
            message: `skill:${skillId} shows ${match[0]} without required projectId`,
          });
        }
      }
    }
  }

  // Rule 5: `generate_image` JSON schema / description must expose Core's
  // allowed aspect ratios and the rule that `headline` requires `styleReferenceId`.
  const imageJson = JSON.stringify(
    z.toJSONSchema(generateImageSchema, { unrepresentable: "any" }),
  );
  const imageContractText = `${imageJson}\n${toolDescriptions.generate_image}`;
  const hasAspectList =
    imageContractText.includes("16:9") &&
    imageContractText.includes("4:5") &&
    imageContractText.includes("5:4");
  const hasHeadlineRule =
    /headline[\s\S]{0,160}styleReferenceId|styleReferenceId[\s\S]{0,160}headline/i.test(
      imageContractText,
    );
  if (!hasAspectList || !hasHeadlineRule) {
    findings.push({
      key: "check4:generate-image-constraints-exposed:schema:generate_image",
      check: "4",
      message:
        "generate_image schema/description does not expose allowed aspectRatio values and headline's styleReferenceId requirement",
    });
  }

  return findings;
}

/** Collects all contract text sources across skills, writing skills, prompts, and rendered tool descriptions. */
export function allContractSources(
  versions: readonly SokoBotVersion[],
): ContractSource[] {
  const renderedDescriptions: ContractSource[] = SOKO_BOT_CAPABILITIES.map(
    (capability) => ({
      label: `desc:base:${capability}`,
      content: SOKO_BOT_TOOL_DESCRIPTIONS[capability],
    }),
  );
  for (const version of versions) {
    if (isFrozenVersion(version)) continue;
    for (const capability of applyVersionCapabilities(
      version,
      SOKO_BOT_CAPABILITIES,
    )) {
      const rendered = sokoBotToolDescription(capability, version);
      if (rendered !== SOKO_BOT_TOOL_DESCRIPTIONS[capability]) {
        renderedDescriptions.push({
          label: `desc:${version.id}:${capability}`,
          content: rendered,
        });
      }
    }
  }
  return [
    ...SOKO_BOT_SKILLS.map((skill) => ({
      label: `skill:${skill.id}`,
      content: skill.content,
    })),
    ...WRITING_SKILLS.map((skill) => ({
      label: `writing:${skill.id}`,
      content: skill.content,
    })),
    ...versions.map((version) => ({
      label: `prompt:${version.id}`,
      content: version.systemPrompt,
    })),
    ...Object.entries(SKILL_INDEX).map(([id, entry]) => ({
      label: `index:${id}`,
      content: entry.useWhen,
    })),
    ...renderedDescriptions,
  ];
}

/** Splits findings into unexpected regressions, known allowlisted drift, and stale allowlist entries. */
export function evaluateContractFindings(
  findings: readonly ContractFinding[],
  knownDrift: Readonly<Record<string, string>> = KNOWN_LIVE_CONTRACT_DRIFT,
): {
  unexpected: ContractFinding[];
  known: ContractFinding[];
  staleAllowlist: string[];
} {
  const unexpected: ContractFinding[] = [];
  const known: ContractFinding[] = [];
  const seenKeys = new Set<string>();
  for (const finding of findings) {
    seenKeys.add(finding.key);
    if (finding.key in knownDrift) known.push(finding);
    else unexpected.push(finding);
  }
  const staleAllowlist = Object.keys(knownDrift).filter(
    (key) => !seenKeys.has(key),
  );
  return { unexpected, known, staleAllowlist };
}
