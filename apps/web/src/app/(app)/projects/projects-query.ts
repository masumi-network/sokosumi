import { createLoader, parseAsStringLiteral } from "nuqs/server";

import { PROJECTS_LIST_STATES } from "./constants";

/**
 * The Projects list's Open / Closed view, read on the server and written by
 * `ProjectsStateToggle`. An unknown `?state=` is the default Open view.
 */
export const projectsSearchParams = {
  state: parseAsStringLiteral(PROJECTS_LIST_STATES).withDefault("open"),
};

export const loadProjectsSearchParams = createLoader(projectsSearchParams);
