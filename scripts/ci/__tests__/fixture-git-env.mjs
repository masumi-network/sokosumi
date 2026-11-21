/**
 * Build an environment for running git (or tools that invoke git) inside a
 * temporary fixture repo, isolated from any inherited GIT_* variables (such
 * as GIT_DIR or GIT_INDEX_FILE) and user/system git config.
 */
export function fixtureGitEnv() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
}
