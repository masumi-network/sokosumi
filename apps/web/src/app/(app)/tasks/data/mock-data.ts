import { AgentJobStatus } from "@sokosumi/database";

import {
  type KanbanColumnDefinition,
  type TaskCardData,
} from "@/app/tasks/types";

export const KANBAN_COLUMNS: KanbanColumnDefinition[] = [
  { id: "backlog", translationKey: "App.Tasks.Columns.backlog" },
  { id: "todo", translationKey: "App.Tasks.Columns.todo" },
  { id: "in-progress", translationKey: "App.Tasks.Columns.inProgress" },
  { id: "input-required", translationKey: "App.Tasks.Columns.inputRequired" },
  {
    id: "refund-requested",
    translationKey: "App.Tasks.Columns.refundRequested",
  },
];

export const MOCK_TASKS: TaskCardData[] = [
  {
    id: "task-1",
    title: "10 Marketing Posts for AI Agent Startup Masumi",
    status: AgentJobStatus.INITIATED,
    budget: 20,
    agents: [
      { name: "Research Agent Web Advanced lookup", status: "done" },
      { name: "Content Agent", status: "pending" },
    ],
    tags: [
      { label: "Web", color: "skyBlue" },
      { label: "Content", color: "persimmon" },
    ],
    orchestrator: "ChatGPT",
    commentsCount: 5,
    date: "2024-08-06",
    columnId: "backlog",
  },
  {
    id: "task-2",
    title: "Landing Page Copy Refresh",
    status: AgentJobStatus.RUNNING,
    budget: 120,
    agents: [
      { name: "UX Writer", status: "done" },
      { name: "Design Agent", status: "pending" },
    ],
    tags: [
      { label: "Web", color: "lightTeal" },
      { label: "Content", color: "irisFlower" },
    ],
    orchestrator: "Orchestrator v2",
    commentsCount: 3,
    date: "2024-08-04",
    columnId: "todo",
  },
  {
    id: "task-3",
    title: "Product Hunt Launch Plan",
    status: AgentJobStatus.FAILED,
    budget: 200,
    agents: [
      { name: "Growth Agent", status: "blocked" },
      { name: "Ads Agent", status: "pending" },
    ],
    tags: [
      { label: "Launch", color: "neonGrass" },
      { label: "Paid", color: "youngGrass" },
    ],
    orchestrator: "LaunchBot",
    commentsCount: 12,
    date: "2024-08-02",
    columnId: "in-progress",
  },
  {
    id: "task-4",
    title: "Customer Onboarding Emails",
    status: AgentJobStatus.AWAITING_INPUT,
    budget: 80,
    agents: [
      { name: "CRM Agent", status: "pending" },
      { name: "Copy Agent", status: "pending" },
    ],
    tags: [
      { label: "Email", color: "skyBlue" },
      { label: "Lifecycle", color: "lightTeal" },
    ],
    orchestrator: "FlowWriter",
    commentsCount: 1,
    date: "2024-08-03",
    columnId: "input-required",
  },
  {
    id: "task-5",
    title: "Issue Refunds for August Campaign",
    status: AgentJobStatus.AWAITING_PAYMENT,
    budget: null,
    agents: [
      { name: "Billing Agent", status: "pending" },
      { name: "Support Agent", status: "done" },
    ],
    tags: [
      { label: "Support", color: "persimmon" },
      { label: "Finance", color: "irisFlower" },
    ],
    orchestrator: "OpsDesk",
    commentsCount: 4,
    date: "2024-08-01",
    columnId: "refund-requested",
  },
  {
    id: "task-6",
    title: "SEO Briefs for Q4 Blogs",
    status: AgentJobStatus.RUNNING,
    budget: 60,
    agents: [
      { name: "SEO Agent", status: "pending" },
      { name: "Content Agent", status: "pending" },
    ],
    tags: [
      { label: "SEO", color: "neonGrass" },
      { label: "Content", color: "lightTeal" },
    ],
    orchestrator: "ResearchBot",
    commentsCount: 2,
    date: "2024-07-30",
    columnId: "todo",
  },
  {
    id: "task-7",
    title: "AI Agent Pricing Page Update",
    status: AgentJobStatus.RUNNING,
    budget: 95,
    agents: [
      { name: "Design Agent", status: "pending" },
      { name: "Copy Agent", status: "pending" },
    ],
    tags: [
      { label: "Web", color: "skyBlue" },
      { label: "Pricing", color: "irisFlower" },
    ],
    orchestrator: "Orchestrator v2",
    commentsCount: 6,
    date: "2024-07-29",
    columnId: "todo",
  },
  {
    id: "task-8",
    title: "Integrations Page FAQ Refresh",
    status: AgentJobStatus.INITIATED,
    budget: 40,
    agents: [
      { name: "Support Agent", status: "pending" },
      { name: "Content Agent", status: "pending" },
    ],
    tags: [
      { label: "Support", color: "persimmon" },
      { label: "Docs", color: "lightTeal" },
    ],
    orchestrator: "DocWriter",
    commentsCount: 0,
    date: "2024-07-28",
    columnId: "todo",
  },
  {
    id: "task-9",
    title: "Onboarding Checklist Automation",
    status: AgentJobStatus.RUNNING,
    budget: 150,
    agents: [
      { name: "CRM Agent", status: "pending" },
      { name: "Workflow Agent", status: "pending" },
    ],
    tags: [
      { label: "Automation", color: "neonGrass" },
      { label: "Lifecycle", color: "lightTeal" },
    ],
    orchestrator: "FlowWriter",
    commentsCount: 7,
    date: "2024-07-27",
    columnId: "todo",
  },
  {
    id: "task-11",
    title: "Campaign Analytics Dashboard",
    status: AgentJobStatus.RUNNING,
    budget: 220,
    agents: [
      { name: "Data Agent", status: "pending" },
      { name: "Design Agent", status: "pending" },
    ],
    tags: [
      { label: "Analytics", color: "irisFlower" },
      { label: "Dashboards", color: "lightTeal" },
    ],
    orchestrator: "InsightBot",
    commentsCount: 9,
    date: "2024-07-25",
    columnId: "in-progress",
  },
  {
    id: "task-12",
    title: "Beta User Outreach Plan",
    status: AgentJobStatus.RUNNING,
    budget: 70,
    agents: [
      { name: "Growth Agent", status: "pending" },
      { name: "Support Agent", status: "pending" },
    ],
    tags: [
      { label: "Growth", color: "neonGrass" },
      { label: "Support", color: "persimmon" },
    ],
    orchestrator: "OutreachBot",
    commentsCount: 3,
    date: "2024-07-24",
    columnId: "in-progress",
  },
  {
    id: "task-13",
    title: "Competitive Landscape Brief",
    status: AgentJobStatus.INITIATED,
    budget: 50,
    agents: [
      { name: "Research Agent", status: "pending" },
      { name: "Strategy Agent", status: "pending" },
    ],
    tags: [
      { label: "Research", color: "neonGrass" },
      { label: "Strategy", color: "youngGrass" },
    ],
    orchestrator: "ResearchBot",
    commentsCount: 4,
    date: "2024-07-23",
    columnId: "backlog",
  },
  {
    id: "task-14",
    title: "Agent Persona Library",
    status: AgentJobStatus.INITIATED,
    budget: 130,
    agents: [
      { name: "Design Agent", status: "pending" },
      { name: "Content Agent", status: "pending" },
    ],
    tags: [
      { label: "Design", color: "skyBlue" },
      { label: "Content", color: "lightTeal" },
    ],
    orchestrator: "PersonaBuilder",
    commentsCount: 8,
    date: "2024-07-22",
    columnId: "backlog",
  },
];
