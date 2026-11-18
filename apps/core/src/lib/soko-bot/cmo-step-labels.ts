/**
 * What a tool call reads as in CMO.xyz while Cuso works. CMO's own words:
 * never a tool's name, and never a Sokosumi feature.
 */
const CMO_STEP_LABELS: Record<string, string> = {
  refresh_context: "Catching up",
  read_memory: "Checking my notes",
  update_memory: "Updating my notes",
  update_plan: "Planning",
  run_subagent: "Asking a helper",
  evaluate_with_jev: "Double-checking",
  web_search: "Searching the web",
  search_exa: "Searching the web",
  web_fetch: "Reading a web page",
  read_social_profile: "Looking at a profile",
  save_brand_brain: "Writing your Brand Brain",
  save_strategy: "Writing your strategy",
  report_update: "Writing a report",
  read_writing_skill: "Checking how to write it",
  find_style_references: "Looking for a picture style",
  list_project_social_accounts: "Checking your accounts",
  get_posting_instructions: "Checking how to post",
  create_social_post: "Writing a post",
  update_social_post: "Changing a post",
  schedule_social_post: "Scheduling a post",
  cancel_social_post: "Cancelling a post",
  publish_social_post: "Publishing a post",
  list_social_posts: "Reading your posts",
  get_social_post: "Reading a post",
  list_social_comments: "Reading comments",
  handle_social_comment: "Replying to a comment",
  generate_image: "Making a picture",
  get_image: "Checking a picture",
  generate_video: "Making a video",
  get_video: "Checking a video",
  generate_talking_video: "Making a talking video",
  generate_voiceover: "Recording a voiceover",
  list_files: "Looking through your files",
  read_file: "Reading a file",
  upload_file: "Saving a file",
  workspace_read: "Reading a file",
  workspace_write: "Writing a file",
  workspace_list: "Looking through files",
  workspace_search: "Searching files",
  start_background_run: "Starting longer work",
  list_background_runs: "Checking longer work",
};

/** Tools that share a label, matched on a part of their name. */
const CMO_STEP_GROUPS: readonly (readonly [RegExp, string])[] = [
  [/statistics/, "Checking your numbers"],
  [/newsletter/, "Working on the newsletter"],
  [/^(list|get|find)_(ad|market)_/, "Checking your ads"],
  [/_ad_campaign$/, "Working on an ad"],
  [/integration/, "Checking your connected tools"],
  [/seo|search_console|keyword/, "Checking your search results"],
  [/schedule|reminder/, "Checking the schedule"],
];

export function cmoCapabilityLabel(capability: string | null): string {
  if (!capability) return "Working";
  return (
    CMO_STEP_LABELS[capability] ??
    CMO_STEP_GROUPS.find(([pattern]) => pattern.test(capability))?.[1] ??
    "Working"
  );
}
