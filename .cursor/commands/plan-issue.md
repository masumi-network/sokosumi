# Plan Linear Issue Implementation

You are tasked with creating a comprehensive implementation plan for a Linear issue with plan-mode to be able to accept the plan. Follow these steps:

## Step 1: Fetch Issue Details

- Use the Linear issue number provided as argument: `$ARGUMENTS`
- Please use the linear mcp to lookup the issue
- Fetch the issue details including:
  - Title and description
  - Labels and priority
  - Acceptance criteria
  - Related issues or dependencies
  - Assignee and timeline

## Step 2: Analyze Requirements

- Break down the issue description into specific requirements
- Identify technical components that need to be modified or created
- Determine dependencies and potential blockers
- Assess complexity and estimated effort

## Step 3: Create Implementation Plan

Create a structured plan with the following sections:

### Overview

- Brief summary of what needs to be implemented
- Key objectives and success criteria

### Technical Approach

- Architecture decisions and patterns to follow
- Technologies, frameworks, or libraries to use
- Database schema changes (if applicable)
- API endpoints (if applicable)

### Implementation Steps

Break down the work into specific, actionable tasks:

1. Setup and preparation tasks
2. Core implementation tasks
3. Testing and validation tasks
4. Documentation and cleanup tasks

### Testing Strategy

- Manual testing scenarios
- Performance considerations

### Deployment Considerations

- Environment requirements
- Migration steps (if applicable)
- Monitoring and observability

## Step 4: Risk Assessment

- Identify potential risks and mitigation strategies
- Dependencies on other teams or systems
- Timeline concerns

## Step 5: Present the Plan

Format the final plan as a comprehensive document that can be accepted by the user that you start to implement the feature

---

**Usage:** `/plan-issue ISSUE-123`

Where ISSUE-123 is the Linear issue identifier you want to plan implementation for.
