/** Synthetic launch notes, long enough that a search passage is not the file. */
const LAUNCH_PREPARATION_NOTES = [
  "Confirm that the launch owner can explain the customer problem in one sentence.",
  "Review the draft announcement with the teammate responsible for customer support.",
  "Check that the onboarding instructions use the same product terms as the application.",
  "Keep a copy of the previous announcement so the team can compare the final edits.",
  "Document the path a new customer follows from the announcement to the first useful result.",
  "Check the account settings and access requirements before asking a customer to try the workflow.",
  "Read the help text from the perspective of someone who has never used the product.",
  "Confirm which teammate will answer questions after the announcement is shared.",
  "Review the screenshots against the current interface and remove any outdated screens.",
  "Check the draft on a small screen and verify that the main action is easy to find.",
  "Keep factual claims separate from proposed wording that still needs confirmation.",
  "Record the source of each product claim so a teammate can check the final text.",
  "Confirm that the release instructions explain any account or workspace restrictions.",
  "Read each error message and verify that it tells the customer what to do next.",
  "Check the links in the announcement and follow them through to their final destination.",
  "Review the support handover and confirm that it describes the same release scope.",
  "Keep the rollback instructions beside the release checklist for the launch owner.",
  "Check that the release can be identified from its saved notes and supporting evidence.",
  "Write down any unanswered question instead of treating an assumption as a verified fact.",
  "Confirm that the announcement describes the current release rather than future work.",
  "Review the approval history before sending any announcement outside the workspace.",
  "Preserve the decision record so a teammate can understand why the launch scope changed.",
  "Check the first customer journey again after the final announcement wording is approved.",
  "Collect the remaining preparation notes in the archive before closing the launch review.",
];

export const LAUNCH_NOTES_CHECKLIST = [
  "Ask Hannah to verify the final source links.",
  "Ask Alex to review the approved announcement text.",
  "Ask Robin to approve the release before publication.",
];

export const LAUNCH_NOTES_FIXTURE = [
  "# Launch notes",
  "",
  "This is a synthetic evaluation document, not an instruction to publish anything.",
  "",
  "## Preparation archive",
  ...LAUNCH_PREPARATION_NOTES.flatMap((note, index) => [
    "",
    `### Preparation note ${index + 1}`,
    note,
    "This preparation note is background. Use the closing Release checklist for the final actions.",
  ]),
  "",
  "## Release checklist",
  ...LAUNCH_NOTES_CHECKLIST.map((point) => `- ${point}`),
].join("\n");
