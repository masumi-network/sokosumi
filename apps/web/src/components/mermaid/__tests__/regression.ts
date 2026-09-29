export const REGRESSION =
  "flowchart LR\n    Schedule[Vercel schedule] --> EVE[EVE + Claude Haiku]\n    EVE --> Proposal[Proposed action]\n    Proposal --> Controller[Controller checks]\n    Controller --> City[Midnight City API]\n    City --> Evidence[Outcome verification]\n    Evidence --> DB[(Neon PostgreSQL)]\n    DB --> Dashboard[Owner dashboard]\n    DB --> EVE";
