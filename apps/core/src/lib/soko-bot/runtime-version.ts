/**
 * Recorded on turns and reported by health checks. Kept in its own module so
 * importing the identifier never drags the agent loop — and everything it
 * depends on — into a caller's import graph.
 */
export const IN_PROCESS_RUNTIME_VERSION = "in-process-1";
