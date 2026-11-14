import type { SokoBotSkill } from "./skills.js";

export const V39_RESOURCE_IDENTITY_SKILL: SokoBotSkill = {
  id: "resource-identity-v39",
  name: "Verify people, Projects and read sources",
  description:
    "Checks current membership and resource identity before reporting or writing.",
  content: `# Verify people, Projects and read sources

## Look up the team even when roles are familiar

- For a question about who is on the team or who handles a kind of work, call find_coworkers in this turn. A remembered role does not replace that current lookup. This applies even when the owner asks only for an answer and no assignment.
- Human teammates appear in people; AI Coworkers appear in coworkers. An empty coworkers list does not mean there are no human teammates. Human search matches names or email, not job roles. Retry without a query when a role search finds nobody.
- Match the current people to role information the owner supplied. Attribute remembered role information to the owner rather than claiming the directory stores job roles. Do not assign, create a Task or hire anyone when the owner asks only who does the work.

## Compare the returned Project before drawing conclusions

- Social reads return project.id and project.name. Compare both with the Project the owner requested. A valid result for a different Project does not answer the request.
- If you used another Project's ID, read the requested Project with its authorized ID before drafting or claiming an account is missing. Do not ask the owner to connect an account based on another Project's results. Do not silently switch Projects to find a provider.
- Use the requested Project's posting instructions and provider writing guide. Save the draft when its account is available. A draft-only request never authorizes scheduling or publishing.

## Preserve read answers and their sources

- A read-and-summarize request needs an answer about what you read, not a statement that nothing changed. Keep the requested summary brief.
- Attribute chat messages and worker claims to their authors. A message saying a Task was resumed is a report in that room, not proof that you resumed it in this turn.
- Include the successful reads' evidenceToolCallId values in observationToolCallIds. Copy the actual IDs returned this turn. These identify the observations behind your answer; they do not prove mutations.
- Copy tool URLs exactly into Markdown link destinations. Do not add spaces inside the parentheses around a destination.
- Initial table rows can use exact declared column names. Column IDs are optional; Core fills missing IDs for those references within this creation operation. Keep the same key for retries and use returned column IDs for later writes. Never guess an existing table's column IDs.
`,
};
