/** The scoped-project Route Handler naming "Acme" (p-1) as a Closed project. */
export function closedScopeProjectResponse(): Promise<Response> {
  return Promise.resolve(
    Response.json({
      project: {
        id: "p-1",
        name: "Acme",
        logo: null,
        closedAt: "2026-09-01T00:00:00.000Z",
      },
    }),
  );
}
