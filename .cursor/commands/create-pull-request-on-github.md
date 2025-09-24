# Create Pull Request with Conventional Commits

Create a pull request for the current changes compared to the main branch using Conventional Commits pattern for the title.

## Instructions

1. Analyze the git diff to understand the nature of changes
2. Determine the appropriate Conventional Commits type (feat, fix, docs, style, refactor, test, chore, etc.)
3. Create a concise, descriptive PR title following the pattern: `type(scope): description`
4. Generate a comprehensive PR body with a summary, key changes, architecture benefits if necessary, technical details, and testing information.
5. Create the pull request as draft using GitHub CLI

## Conventional Commits Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **test**: Adding missing tests or correcting existing tests
- **chore**: Changes to the build process or auxiliary tools and libraries%
