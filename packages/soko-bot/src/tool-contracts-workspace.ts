import { z } from "zod";
import {
  CHAT_RESULT_PREVIEW_LIMIT,
  chatResultReferenceSchema,
} from "./result-previews.js";

const workspacePathSchema = z.string().trim().min(1).max(500);

export const sokoBotPostChatInputSchema = z.object({
  resultReferences: z
    .array(chatResultReferenceSchema)
    .max(CHAT_RESULT_PREVIEW_LIMIT)
    .optional(),
  /** Room id from `list_chats`. */
  roomId: z.string().min(1),
  content: z.string().min(1).max(4_000),
});

export const sokoBotListFilesInputSchema = z.object({
  /** Words to find in file names and contents; omit to list the newest. */
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export const sokoBotReadFileInputSchema = z
  .object({
    /** File id from `list_files`. */
    fileId: z.string().min(1),
    maxChars: z.number().int().min(500).max(40_000).optional(),
  })
  .strict();

/** Largest workspace file upload_file saves; the sandbox sends it to storage directly. */
export const SOKO_BOT_WORKSPACE_UPLOAD_MAX_BYTES = 50_000_000;

export const sokoBotUploadFileInputSchema = z.object({
  /** File name including extension, e.g. "launch-brief.md". */
  filename: z.string().min(1).max(200),
  /** Text content to store. Give this or attachmentUrl, not both. */
  content: z.string().min(1).max(200_000).optional(),
  /** Link of a file someone attached in a chat you are in, to save as is (any type). */
  attachmentUrl: z.string().url().max(2_000).optional(),
  /** A file in your sandbox workspace to save as is, e.g. "out/launch.mp4". */
  workspacePath: z.string().trim().min(1).max(500).optional(),
  /** Filled in by the sandbox once it uploaded workspacePath; never write it yourself. */
  uploadedPathname: z.string().min(1).max(1_000).optional(),
  /** MIME type; defaults to text/markdown. */
  contentType: z.string().max(120).optional(),
  /** Replace an existing text file of the same name with this content. */
  overwrite: z.boolean().optional(),
  /**
   * Folder to save into, e.g. "Masumi Fundraising" or "Marketing/Q4". A
   * folder that does not exist yet is created. Omit for the top level.
   */
  folder: z.string().trim().min(1).max(200).optional(),
});

export const sokoBotUpdateEmailsInputSchema = z
  .object({
    /** Mailbox provider from list_integrations; omit when only one is connected. */
    provider: z.string().min(1).max(40).optional(),
    /** Message ids from search_inbox or read_email. */
    messageIds: z.array(z.string().min(1).max(200)).min(1).max(100),
    /** true marks them read, false unread. */
    read: z.boolean().optional(),
    /** Moves them out of the inbox (Gmail archive); nothing is deleted. */
    archive: z.boolean().optional(),
  })
  .strict();

export const sokoBotDraftEmailInputSchema = z
  .object({
    provider: z.string().min(1).max(40).optional(),
    to: z.array(z.string().email().max(320)).min(1).max(20),
    cc: z.array(z.string().email().max(320)).max(20).optional(),
    subject: z.string().max(300),
    body: z.string().min(1).max(50_000),
    /** Reply in the thread of this message (id from search_inbox). */
    replyToMessageId: z.string().min(1).max(200).optional(),
  })
  .strict();

export const sokoBotSaveEmailAttachmentInputSchema = z
  .object({
    provider: z.string().optional(),
    messageId: z.string().min(1),
    /** The attachment's id from read_email. */
    attachmentId: z.string().min(1),
    /** The attachment's filename from read_email. */
    filename: z.string().trim().min(1).max(200),
    /** Folder in the owner's Files, e.g. "Finance/Invoices"; omit for the top level. */
    folder: z.string().trim().min(1).max(200).optional(),
    /** Save under another name; keeps the attachment's name when omitted. */
    saveAs: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const sokoBotSendEmailDraftInputSchema = z
  .object({ draftId: z.string().min(1).max(200) })
  .strict();

export const sokoBotMoveFileInputSchema = z
  .object({
    /** Drive file id from list_files or upload_file. */
    fileId: z.string().min(1),
    /** Destination folder, e.g. "Masumi Fundraising" or "Clients/Acme"; "" for the top level. */
    folder: z.string().trim().max(200),
  })
  .strict();

export const sokoBotDeleteFileInputSchema = z
  .object({
    /** Drive file id from list_files or upload_file. */
    fileId: z.string().min(1),
  })
  .strict();

export const sokoBotListSkillsInputSchema = z
  .object({
    /** Words to search the skills.sh catalog for; omit to list only installed skills. */
    query: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const sokoBotInstallSkillInputSchema = z
  .object({
    /** owner/repo, owner/repo/skill, or a skills.sh / GitHub URL (from list_skills). */
    source: z.string().trim().min(3).max(300),
    /** Which skill in a repository with several. */
    skillName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const sokoBotRemoveSkillInputSchema = z
  .object({
    /** Installed skill id or name from list_skills. */
    skill: z.string().trim().min(1).max(200),
  })
  .strict();

export const sokoBotGenerateImageInputSchema = z
  .object({
    /** Project whose Content Studio receives the image. */
    projectId: z.string().min(1),
    prompt: z.string().trim().min(1).max(4_000),
    /** Width:height such as "16:9"; the studio checks it. Defaults to 1:1. */
    aspectRatio: z.string().max(10).optional(),
    /** Image Files (product photos) the new image must show or match. */
    referenceFileIds: z.array(z.uuid()).max(4).optional(),
    /** Most credits this image may cost; the price is checked first. */
    maxCredits: z.number().positive().max(10_000),
    /** A Content Studio model id; leave it out for the default, Muse Image. */
    model: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const sokoBotGetImageInputSchema = z
  .object({ projectId: z.string().min(1), jobId: z.string().min(1) })
  .strict();

export const sokoBotGenerateVideoInputSchema = z
  .object({
    /** Project whose Content Studio receives the video. */
    projectId: z.string().min(1),
    prompt: z.string().trim().min(1).max(4_000),
    /** "9:16" (default; Reels, Shorts, TikTok), "16:9", "1:1", "4:3" or "3:4". Ignored when animating an image. */
    aspectRatio: z.string().max(10).optional(),
    /** 5 (default), 10 or 15. */
    durationSeconds: z.number().int().optional(),
    /** "standard" (default, cheaper) or "high". */
    quality: z.enum(["standard", "high"]).optional(),
    /** A finished generate_image job in this Project whose image to animate. */
    imageJobId: z.string().min(1).optional(),
    /** Most credits this video may cost; the price is checked first. */
    maxCredits: z.number().positive().max(10_000),
  })
  .strict();

export const sokoBotGetVideoInputSchema = sokoBotGetImageInputSchema;

/** Voices a voice-over can use: ElevenLabs' stock voices. */
export const SOKO_BOT_VOICEOVER_VOICES = [
  "Aria",
  "Roger",
  "Sarah",
  "Laura",
  "Charlie",
  "George",
  "Callum",
  "River",
  "Liam",
  "Charlotte",
  "Alice",
  "Matilda",
  "Will",
  "Jessica",
  "Eric",
  "Chris",
  "Brian",
  "Daniel",
  "Lily",
  "Bill",
] as const;

export const sokoBotGenerateVoiceoverInputSchema = z.object({
  /** The words to speak. Audio tags such as [excited] or [whispering] steer delivery. */
  text: z.string().trim().min(1).max(5_000),
  /** One of the stock voices; Brian by default. */
  voice: z.enum(SOKO_BOT_VOICEOVER_VOICES).optional(),
  /** ISO 639-1 language of the text, e.g. "de"; detected when left out. */
  languageCode: z.string().trim().length(2).optional(),
  /** File name with .mp3, e.g. "launch-voiceover.mp3". */
  filename: z.string().trim().min(1).max(200),
  /** Folder in Files to save into; created if missing. */
  folder: z.string().trim().min(1).max(200).optional(),
  /** Also put the mp3 at this path in your workspace, to cut it into a video. */
  workspacePath: z.string().trim().min(1).max(500).optional(),
});

export const sokoBotWorkspaceImportFileInputSchema = z.object({
  /** Files id from list_files, upload_file, get_image, get_video or generate_voiceover. */
  fileId: z.uuid(),
  /** Where to put it in your workspace, e.g. "assets/logo.png". */
  path: z.string().trim().min(1).max(500),
});

export const sokoBotOpenDirectChatInputSchema = z.object({
  /** Who to reach: their name or email address, as your owner said it. Must be someone in your owner's organization. */
  person: z.string().min(1).max(200),
  /** What to say. Sent as the first message, so introduce yourself and say why you are writing. */
  message: z.string().min(1).max(4_000),
});

export const sokoBotAskCoworkerInputSchema = z
  .object({
    /** Coworker ids from `find_coworkers` or your context; at most three. */
    coworkerIds: z.array(z.string().min(1)).min(1).max(3),
    /** The question, posted as the first message with each Coworker mentioned. */
    question: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const sokoBotReadChatInputSchema = z.object({
  /** Room id from `list_chats`. */
  roomId: z.string().min(1),
  /** Newest messages first; default 30. */
  limit: z.number().int().min(1).max(100).optional(),
  /** Only messages before this ISO timestamp, to page further back. */
  before: z.string().datetime().optional(),
});

export const sokoBotSearchInboxInputSchema = z.object({
  /** Free-text search (sender, subject, words). Provider search syntax works (e.g. Gmail `from:x newer_than:2d`). */
  query: z.string().max(500).optional(),
  /** Only mail received after this ISO timestamp. */
  since: z.string().datetime().optional(),
  unreadOnly: z.boolean().optional(),
  /** Restrict to one connected provider id; default all email providers. */
  provider: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  /** `nextPageToken` from the previous page of the same provider and query. */
  pageToken: z.string().max(2_000).optional(),
});

export const sokoBotReadEmailInputSchema = z.object({
  provider: z.string(),
  messageId: z.string(),
});

/** Short enough to stay a cheap judgement, long enough for a page of mail. */
export const JEV_STATE_MAX = 12_000;

export const jevKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, "letters, digits and _, max 40");

export const sokoBotEvaluateWithJevInputSchema = z
  .object({
    /** What Jev judges: plain text, or JSON as a string (parsed when valid). */
    state: z.string().trim().min(1).max(JEV_STATE_MAX),
    questions: z
      .array(
        z
          .object({
            key: jevKeySchema,
            /** What to judge, about which item; yes/no unless options are given. */
            question: z.string().trim().min(1).max(1_000),
            /** Named options with what each means; makes it a choice. */
            options: z
              .array(
                z
                  .object({
                    name: jevKeySchema,
                    criteria: z.string().trim().min(1).max(500),
                  })
                  .strict(),
              )
              .min(2)
              .max(8)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .superRefine((input, ctx) => {
    const keys = input.questions.map((question) => question.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "question keys must be unique" });
    for (const question of input.questions) {
      const names = question.options?.map((option) => option.name) ?? [];
      if (new Set(names).size !== names.length)
        ctx.addIssue({
          code: "custom",
          message: `option names of ${question.key} must be unique`,
        });
    }
  });

export const sokoBotListCalendarEventsInputSchema = z.object({
  /** ISO start of the window; default now. */
  from: z.string().datetime().optional(),
  /** ISO end of the window; default 7 days after `from`. */
  to: z.string().datetime().optional(),
  provider: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const sokoBotListIntegrationToolsInputSchema = z.object({
  /** Connected provider id (Composio toolkit slug), e.g. "slack", "notion", "linear". */
  provider: z.string(),
  /** Words from what you want to do; narrows the list. */
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const sokoBotRunIntegrationToolInputSchema = z.object({
  provider: z.string(),
  /** Tool slug exactly as list_integration_tools returned it. */
  tool: z.string(),
  /** Arguments matching the tool's input schema. */
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const sokoBotManageReminderInputSchema = z
  .object({
    key: z.string().min(1).max(200),
    action: z.enum(["ACKNOWLEDGE", "SNOOZE", "CANCEL"]),
    revision: z.number().int().positive(),
    snoozedUntil: z.string().datetime().optional(),
  })
  .strict();

/** The kinds of page Exa can limit a search to. */
export const SOKO_BOT_EXA_CATEGORIES = [
  "company",
  "news",
  "people",
  "personal site",
  "financial report",
  "publication",
] as const;

export const sokoBotSearchExaInputSchema = z
  .object({
    /** A description of the pages wanted, not keywords. */
    query: z.string().trim().min(1).max(400),
    category: z.enum(SOKO_BOT_EXA_CATEGORIES).optional(),
    includeDomains: z
      .array(z.string().trim().min(1).max(200))
      .max(20)
      .optional(),
    excludeDomains: z
      .array(z.string().trim().min(1).max(200))
      .max(20)
      .optional(),
    /** Only pages published on or after this day (not with company or people). */
    startPublishedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .optional(),
    numResults: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export const sokoBotWebFetchInputSchema = z
  .object({
    url: z.url(),
    maxChars: z.number().int().min(500).max(100_000).optional(),
  })
  .strict();

export const sokoBotBashInputSchema = z
  .object({
    command: z.string().min(1).max(8_000),
    timeoutSeconds: z.number().int().min(1).max(600).optional(),
  })
  .strict();

export const sokoBotWorkspaceReadInputSchema = z
  .object({
    path: workspacePathSchema,
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(200_000).optional(),
  })
  .strict();

export const sokoBotWorkspaceWriteInputSchema = z
  .object({
    path: workspacePathSchema,
    content: z.string().max(1_000_000),
    append: z.boolean().optional(),
  })
  .strict();

export const sokoBotWorkspaceListInputSchema = z
  .object({
    path: workspacePathSchema.optional(),
    pattern: z.string().trim().max(200).optional(),
  })
  .strict();

export const sokoBotWorkspaceSearchInputSchema = z
  .object({
    pattern: z.string().min(1).max(500),
    path: workspacePathSchema.optional(),
  })
  .strict();

export const sokoBotUpdatePlanInputSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            step: z.string().trim().min(1).max(300),
            status: z.enum(["pending", "in_progress", "done"]),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export const sokoBotRunSubagentInputSchema = z
  .object({ task: z.string().trim().min(1).max(4_000) })
  .strict();

export const SOKO_BOT_WAIT_KINDS = [
  "studio_job",
  "background_run",
  "chat_reply",
  "app_connected",
] as const;

export const sokoBotWaitForInputSchema = z
  .object({
    /** studio_job: an image or video; background_run: a run; chat_reply: a room; app_connected: an app. */
    kind: z.enum(SOKO_BOT_WAIT_KINDS),
    /** The jobId from generate_image/generate_video, the runId, the roomId, or the app's provider from find_integrations. */
    id: z.string().trim().min(1),
    /** The Project of a studio_job. */
    projectId: z.string().trim().min(1).optional(),
    /** What to do once it is done, with every id it needs. */
    then: z.string().trim().min(1).max(2_000),
    /** How long to wait at most; then the plan runs with what there is. */
    timeoutMinutes: z.number().int().min(1).max(1_440).optional(),
  })
  .strict();

export const sokoBotStartBackgroundRunInputSchema = z
  .object({
    /** Short name the owner sees, e.g. "Gmail CRM, Oct 2023 – Oct 2026". */
    title: z.string().trim().min(1).max(120),
    /** Everything the run needs: it does not see this conversation. */
    brief: z.string().trim().min(1).max(8_000),
  })
  .strict();

export const backgroundRunRefSchema = z.object({ runId: z.uuid() }).strict();

export const sokoBotWebSearchInputSchema = z
  .object({ query: z.string().trim().min(1).max(400) })
  .strict();
