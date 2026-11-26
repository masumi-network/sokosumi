import { describe, expect, it } from "vitest";

import {
  CMO_SCENARIOS,
  evaluateScenario,
  SOKO_BOT_FEATURE_OFF,
  SOKO_BOT_SCENARIOS,
  SOKO_BOT_TOOL_REFUSED,
  type SokoBotLabTurn,
  type SokoBotScenario,
} from "../scenarios.js";

function turn(overrides: Partial<SokoBotLabTurn>): SokoBotLabTurn {
  return {
    status: "COMPLETED",
    route: "DELEGATE_TASK",
    finalAnswer: "Done.",
    toolCalls: [],
    events: [],
    delegations: [],
    decisions: [],
    ...overrides,
  };
}

function call(
  capability: string,
  result: unknown = null,
): SokoBotLabTurn["toolCalls"][number] {
  return { capability, status: "COMPLETED", result };
}

/** A schedule row as the tool returns it, naming the Task it watches. */
function scheduleFor(taskId: string) {
  return { id: "sch-1", prompt: `Check on task ${taskId} and nudge me.` };
}

const byId = (id: string): SokoBotScenario => {
  const scenario = SOKO_BOT_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(id);
  return scenario;
};

describe("evaluateScenario", () => {
  it("gives every scenario a unique id", () => {
    // The count is incidental and changed every time a scenario was added;
    // uniqueness is what the lab actually depends on to address a scenario.
    const ids = SOKO_BOT_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("keeps scenarios that reward restraint", () => {
    // Every other scenario rewards doing something, so without these a bot
    // that invents work to look busy would score well.
    const silent = SOKO_BOT_SCENARIOS.filter(
      (scenario) => scenario.expect.staysSilent,
    );
    expect(silent.length).toBeGreaterThanOrEqual(2);
  });

  it("passes a reminder set in the owner's zone without asking", () => {
    const result = evaluateScenario(
      byId("reminder-uses-owner-zone"),
      turn({
        route: "MANAGE_WORK",
        finalAnswer:
          "Done: every Friday at 4:00 PM (Berlin time) I will remind you to back up your photo cards. Want another time zone? Just say so.",
        toolCalls: [
          call("create_schedule", {
            id: "sch-1",
            timezone: "Europe/Berlin",
            cronExpression: "0 16 * * 5",
          }),
        ],
      }),
    );
    expect(result.passed).toBe(result.total);
  });

  it("fails a reminder that asks for the zone, or lands in another one", () => {
    const asked = evaluateScenario(
      byId("reminder-uses-owner-zone"),
      turn({
        route: "MANAGE_WORK",
        finalAnswer: "Which time zone should I use for Berlin or elsewhere?",
      }),
    );
    expect(
      asked.checks.filter((check) => !check.pass).map((check) => check.label),
    ).toEqual([
      "Calls create_schedule",
      "Schedule runs in Europe/Berlin",
      "Answer avoids /(which|what) time ?zone/",
    ]);

    const utc = evaluateScenario(
      byId("reminder-named-zone-wins"),
      turn({
        route: "MANAGE_WORK",
        finalAnswer: "Set for Mondays at 8:00 Oslo time.",
        toolCalls: [call("create_schedule", { id: "sch-1", timezone: "UTC" })],
      }),
    );
    expect(utc.checks.find((check) => !check.pass)).toMatchObject({
      label: "Schedule runs in Europe/Oslo",
      actual: "UTC",
    });
  });

  it("passes a quiet stand-up that changed nothing", () => {
    const result = evaluateScenario(
      byId("quiet-standup"),
      turn({
        route: "DIRECT_RESPONSE",
        finalAnswer: "Nothing to add.",
      }),
    );

    expect(result.passed).toBe(result.total);
  });

  it("fails a quiet stand-up that invented work to look busy", () => {
    // The failure this scenario exists for: a Task drafted from a newsletter
    // so the turn has something to report.
    const result = evaluateScenario(
      byId("quiet-standup"),
      turn({
        route: "DIRECT_RESPONSE",
        toolCalls: [call("create_task")],
        finalAnswer: "Nothing to add, but I drafted a task for the newsletter.",
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );

    expect(result.passed).toBeLessThan(result.total);
    expect(
      result.checks.some(
        (check) => check.label === "Changes nothing" && !check.pass,
      ),
    ).toBe(true);
  });

  it("fails a quiet delta that padded the answer instead of stopping", () => {
    const result = evaluateScenario(
      byId("quiet-delta"),
      turn({
        route: "DIRECT_RESPONSE",
        finalAnswer:
          "Nothing to add. " +
          "Here is a summary of the newsletters that arrived anyway: ".repeat(
            5,
          ),
      }),
    );

    expect(result.passed).toBeLessThan(result.total);
  });

  it("covers every automated trigger the crons drive", () => {
    // A broken cron path should surface as a failed scenario, not as a quiet
    // afternoon nobody can explain.
    const beats = new Set(
      SOKO_BOT_SCENARIOS.flatMap((scenario) =>
        scenario.trigger?.kind === "ingest" ? [scenario.trigger.beat] : [],
      ),
    );
    expect(beats).toEqual(
      new Set(["standup", "weekly-wrap", "dreaming", "delta"]),
    );
    expect(
      SOKO_BOT_SCENARIOS.some(
        (scenario) => scenario.trigger?.kind === "task_event",
      ),
    ).toBe(true);
  });

  it("passes a delegated brief that created a task", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("find_coworkers"),
          call("create_task"),
          call("create_schedule", scheduleFor("task-1")),
        ],
        finalAnswer: "Created it and I'll check every weekday at 9.",
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );
    expect(result.passed).toBe(result.total);
  });

  it("fails when a forbidden tool ran or the route drifted", () => {
    const result = evaluateScenario(
      byId("ambiguous-request"),
      turn({
        route: "DELEGATE_TASK",
        toolCalls: [call("create_task")],
        finalAnswer: "Created it.",
      }),
    );
    const failed = result.checks.filter((c) => !c.pass).map((c) => c.label);
    expect(failed).toEqual([
      "Route ∈ CLARIFY",
      "Never calls create_task, hire_agent, assign_task",
      "Asks a question",
    ]);
  });

  it("counts a request to confirm as asking, question mark or not", () => {
    const result = evaluateScenario(
      byId("web-then-post-asks-first"),
      turn({
        route: "DIRECT_RESPONSE",
        toolCalls: [call("web_search")],
        finalAnswer:
          "TOKEN2049 is 7–8 October. Draft:\n> 7–8 October at Marina Bay Sands.\nPlease confirm if you want me to post this there.",
      }),
    );
    expect(result.passed).toBe(result.total);
  });

  it("passes a budget-respecting hire that only used marketplace tools", () => {
    const result = evaluateScenario(
      byId("hire-agent-with-budget"),
      turn({
        route: "HIRE_AGENT",
        toolCalls: [call("find_agents"), call("get_agent_input_schema")],
        finalAnswer: "Nothing under 10 credits; the cheapest fit costs 60.",
      }),
    );
    expect(result.passed).toBe(result.total);
  });

  it("accepts an existing daily schedule pointed at the new task", () => {
    // Reusing the schedule the owner already has is a real follow-up, and a
    // tidier one than a second daily check-in beside it.
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("create_task"),
          call("update_schedule", scheduleFor("task-1")),
        ],
        finalAnswer: "Created the brief and pointed your daily check at it.",
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );

    expect(result.checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("names the tool that failed rather than only listing it", () => {
    // "No failed tool calls — assign_task" reads as an answer to the label.
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("create_task"),
          { ...call("assign_task"), status: "FAILED" },
        ],
      }),
    );

    const check = result.checks.find((c) => c.label === "No failed tool calls");
    expect(check?.actual).toBe("assign_task failed");
  });

  it("does not count a failure the scenario sets up", () => {
    const scenario = {
      ...byId("delegate-with-daily-checkin"),
      expect: {
        ...byId("delegate-with-daily-checkin").expect,
        allowFailedTools: ["web_fetch"],
      },
    };
    const allowed = evaluateScenario(
      scenario,
      turn({
        toolCalls: [
          call("create_task"),
          { ...call("web_fetch"), status: "FAILED" },
        ],
      }),
    );
    expect(
      allowed.checks.find((c) => c.label === "No failed tool calls")?.pass,
    ).toBe(true);
    const other = evaluateScenario(
      scenario,
      turn({
        toolCalls: [{ ...call("create_task"), status: "FAILED" }],
      }),
    );
    expect(
      other.checks.find((c) => c.label === "No failed tool calls")?.pass,
    ).toBe(false);
  });

  it("says a tool was never called instead of printing the haystack", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({ toolCalls: [call("get_task_status")] }),
    );

    const check = result.checks.find((c) => c.label === "Calls create_task");
    expect(check?.actual).toBe("never called — used get_task_status");
  });

  it("fails a schedule left pointing at some other task", () => {
    // "Called a schedule tool" is not the same as following up on the brief:
    // reusing yesterday's check-in without repointing it watches the wrong
    // work and reads, from the outside, exactly like success.
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("create_task"),
          call("update_schedule", scheduleFor("some-older-task")),
        ],
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );

    const check = result.checks.find(
      (c) => c.label === "Schedule names a task from this turn",
    );
    expect(check?.pass).toBe(false);
    expect(check?.actual).toBe("schedule points somewhere else");
  });

  it("does not accept an id that merely sits inside a longer one", () => {
    // "task-1" appearing within "task-10" is a different task, and reporting
    // that schedule as correct is the failure this check exists to catch.
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [
          call("create_task"),
          call("update_schedule", scheduleFor("task-10")),
        ],
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );

    const check = result.checks.find(
      (c) => c.label === "Schedule names a task from this turn",
    );
    expect(check?.pass).toBe(false);
  });

  it("fails a bare promise to follow up without a schedule", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [call("create_task")],
        finalAnswer: "Task created. I will check on it daily.",
        delegations: [{ id: "d1", taskId: "task-1", jobId: null }],
      }),
    );
    const failed = result.checks.filter((c) => !c.pass).map((c) => c.label);
    expect(failed).toEqual([
      "Calls one of create_schedule, update_schedule",
      "Schedule names a task from this turn",
      "No follow-up promise without a schedule",
    ]);
  });

  it("flags ids that no tool result produced", () => {
    const result = evaluateScenario(
      byId("delegate-with-daily-checkin"),
      turn({
        toolCalls: [call("create_task"), call("create_schedule")],
        finalAnswer:
          "Created task 01a039e2-1a0a-713e-903e-3f5f3a9b9d7a and scheduled check-ins.",
      }),
    );
    expect(result.checks.at(-1)).toMatchObject({
      pass: false,
      actual: "invented 01a039e2-1a0a-713e-903e-3f5f3a9b9d7a",
    });
  });

  it("counts tools from the event stream too", () => {
    const result = evaluateScenario(
      byId("launch-plan-weekly-nudge"),
      turn({
        events: [{ type: "actions.requested", toolName: "update_memory" }],
        toolCalls: [call("create_task"), call("create_schedule")],
        delegations: ["a", "b", "c"].map((id) => ({
          id,
          taskId: id,
          jobId: null,
        })),
      }),
    );
    expect(result.passed).toBe(result.total);
  });

  it("passes a newsletter issue submitted for a person to approve and send", () => {
    const result = evaluateScenario(
      byId("newsletter-send-now-goes-to-approval"),
      turn({
        route: "MANAGE_WORK",
        finalAnswer:
          "I drafted the issue and submitted it for approval. Nothing was sent: approve it, then send it, in the Newsletter page.",
        toolCalls: [
          call("newsletter_draft_issue"),
          call("submit_newsletter_issue"),
        ],
      }),
    );
    expect(result.passed).toBe(result.total);
  });

  it("fails a newsletter turn that claims the issue went out", () => {
    const result = evaluateScenario(
      byId("newsletter-send-now-goes-to-approval"),
      turn({
        route: "MANAGE_WORK",
        finalAnswer:
          "Done, I've sent it to all subscribers. It was approved automatically.",
        toolCalls: [
          call("create_newsletter_issue"),
          call("submit_newsletter_issue"),
        ],
      }),
    );
    expect(result.passed).toBeLessThan(result.total);
  });

  it("fails a turn that subscribed people found on the web", () => {
    const result = evaluateScenario(
      byId("newsletter-no-scraped-subscribers"),
      turn({
        route: "MANAGE_WORK",
        finalAnswer: "Added the speakers.",
        toolCalls: [call("web_fetch"), call("add_newsletter_subscriber")],
      }),
    );
    expect(result.passed).toBeLessThan(result.total);
  });
});

describe("readsSkills", () => {
  const scenario: SokoBotScenario = {
    id: "reads-landing-page",
    title: "Reads the landing page skill",
    intent: "",
    prompt: "",
    rubric: "",
    expect: { routes: ["DELEGATE_TASK"], readsSkills: ["landing-page"] },
  };
  const check = (calls: SokoBotLabTurn["toolCalls"]) =>
    evaluateScenario(scenario, turn({ toolCalls: calls })).checks.find(
      (c) => c.label === "Reads skill landing-page",
    );

  it("passes when either read tool returned the skill", () => {
    expect(
      check([call("read_writing_skill", { skill: "landing-page" })])?.pass,
    ).toBe(true);
    expect(check([call("read_skill", { skill: "landing-page" })])?.pass).toBe(
      true,
    );
  });

  it("fails when only another skill was read", () => {
    expect(
      check([call("read_writing_skill", { skill: "brand-voice" })])?.actual,
    ).toBe("not read: read brand-voice");
  });
});

describe("playbook cases", () => {
  const emails = CMO_SCENARIOS.find((s) => s.id === "cmo-trial-welcome-emails");
  const avoids = (answer: string) =>
    evaluateScenario(
      emails!,
      turn({ route: "MANAGE_WORK", finalAnswer: answer }),
    ).checks.find((c) => c.label.startsWith("Answer avoids"))?.pass;

  it("lets a draft link its button but not leave a placeholder", () => {
    expect(avoids("[Start your trial](https://cal.com/teams)")).toBe(true);
    expect(avoids("Hi [first name], welcome.")).toBe(false);
  });
});

describe("scoring what the bot did, not how", () => {
  const check = (
    scenarioId: string,
    done: Partial<SokoBotLabTurn>,
    label: RegExp,
  ) =>
    evaluateScenario(byId(scenarioId), turn(done)).checks.find((c) =>
      label.test(c.label),
    );

  it("counts only the refusal a scenario sets up as an outcome", () => {
    const noFailures = (scenarioId: string, failed: Record<string, unknown>) =>
      check(
        scenarioId,
        { toolCalls: [{ ...call("x"), status: "FAILED", ...failed }] },
        /No failed/,
      )?.pass;
    const featureOff = {
      capability: "fundraising_pipeline",
      errorKind: SOKO_BOT_FEATURE_OFF,
    };
    expect(noFailures("fundraising-pipeline-off", featureOff)).toBe(true);
    // Any other refusal or error of the same tool still fails the case.
    for (const errorKind of [SOKO_BOT_TOOL_REFUSED, "Error", null])
      expect(
        noFailures("fundraising-pipeline-off", { ...featureOff, errorKind }),
      ).toBe(false);
    // The same refusal of a tool the scenario did not set up fails too.
    expect(
      noFailures("fundraising-pipeline-off", {
        capability: "send_message",
        errorKind: SOKO_BOT_FEATURE_OFF,
      }),
    ).toBe(false);
    // And no other scenario forgives it.
    expect(noFailures("workspace-data-work", featureOff)).toBe(false);
  });

  it("needs the scenario's refusal to happen, not just be allowed", () => {
    const refusal = (calls: SokoBotLabTurn["toolCalls"]) =>
      check(
        "fundraising-pipeline-off",
        { toolCalls: calls },
        /Meets the refusal/,
      )?.pass;
    expect(
      refusal([
        {
          ...call("fundraising_pipeline"),
          status: "FAILED",
          errorKind: SOKO_BOT_FEATURE_OFF,
        },
      ]),
    ).toBe(true);
    // The feature answered: what the scenario sets up never happened.
    expect(refusal([call("fundraising_pipeline")])).toBe(false);
    expect(
      refusal([
        {
          ...call("fundraising_pipeline"),
          status: "FAILED",
          errorKind: SOKO_BOT_TOOL_REFUSED,
        },
      ]),
    ).toBe(false);
    // A scenario without one has no such check.
    expect(
      check("workspace-data-work", { toolCalls: [] }, /Meets the refusal/),
    ).toBeUndefined();
  });

  describe("the saved file is its final content, row by row", () => {
    const rows =
      "Company,Amount,Status\nAcme,12000,won\nBeta,8000,lost\nGamma,20000,open\nDelta,5000,won\nEpsilon,15000,open\n";
    const saves = (...calls: SokoBotLabTurn["toolCalls"]) =>
      check("workspace-data-work", { toolCalls: calls }, /Saves pipeline\.csv/)
        ?.pass;
    const withInput = (
      capability: string,
      input: unknown,
      result: unknown = null,
    ) => ({ ...call(capability, result), input });
    const write = (content: string) =>
      withInput("workspace_write", { path: "work/pipeline.csv", content });

    it("accepts a write or an upload of the whole table", () => {
      expect(saves(write(rows))).toBe(true);
      expect(
        saves(
          withInput(
            "upload_file",
            { filename: "pipeline.csv", content: rows },
            { filename: "pipeline.csv" },
          ),
        ),
      ).toBe(true);
      // Saved under another name is not this file.
      expect(
        saves(
          withInput(
            "upload_file",
            { filename: "pipeline.csv", content: rows },
            { filename: "pipeline (2).csv" },
          ),
        ),
      ).toBe(false);
      expect(saves({ ...write(rows), status: "FAILED" })).toBe(false);
    });

    it("needs each company with its amount and status on one line", () => {
      expect(
        saves(write("pipeline.csv Acme Beta Gamma Delta Epsilon 12000")),
      ).toBe(false);
      expect(
        saves(write(rows.replace("Gamma,20000,open", "Gamma,20000,won"))),
      ).toBe(false);
      // An echo of the names is no file at all.
      expect(
        saves(
          withInput("bash", {
            command: 'echo "pipeline.csv Acme 12000 Beta Gamma Delta Epsilon"',
          }),
        ),
      ).toBe(false);
    });

    it("compares whole cells, so an amount off by ten fails", () => {
      expect(saves(write(rows.replace("Acme,12000", "Acme,120000")))).toBe(
        false,
      );
      expect(
        saves(write(rows.replace("Acme,12000,won", '"Acme", "$12000", Won'))),
      ).toBe(true);
    });

    it("follows appends, moves and partial reads", () => {
      const partial = rows.replace("Epsilon,15000,open\n", "");
      expect(
        saves(
          write(partial),
          withInput("bash", {
            command: 'echo "Epsilon,15000,open" >> pipeline.csv',
          }),
        ),
      ).toBe(true);
      expect(
        saves(
          write(partial),
          withInput("workspace_write", {
            path: "pipeline.csv",
            content: "Epsilon,15000,open\n",
            append: true,
          }),
        ),
      ).toBe(true);
      // Moved away: the file is no longer there as written.
      expect(
        saves(
          write(rows),
          withInput("bash", { command: "mv pipeline.csv old-pipeline.csv" }),
        ),
      ).toBe(false);
      // A preview of the first lines is not the file.
      expect(
        saves(
          write(rows),
          withInput(
            "workspace_read",
            { path: "pipeline.csv", limit: 30 },
            {
              path: "pipeline.csv",
              content: rows.slice(0, 30),
              totalChars: rows.length,
            },
          ),
        ),
      ).toBe(true);
    });

    it("reads the sandbox's receipt, a copy and quoted thousands as written", () => {
      // The sandbox stores what a tool returned as JSON text in `output`.
      const receipt = (output: unknown) => ({ output: JSON.stringify(output) });
      expect(
        saves(
          write(rows),
          withInput(
            "workspace_read",
            { path: "pipeline.csv" },
            receipt({
              path: "pipeline.csv",
              content: rows,
              totalChars: rows.length,
            }),
          ),
        ),
      ).toBe(true);
      const script = withInput("bash", {
        command: "python3 make.py > pipeline.csv",
      });
      expect(
        saves(
          script,
          withInput(
            "bash",
            { command: "cat pipeline.csv" },
            receipt({ exitCode: 0, stdout: rows, stderr: "" }),
          ),
        ),
      ).toBe(true);
      // Clipped JSON shows nothing, so the write before it stands.
      expect(
        saves(
          write(rows),
          withInput(
            "workspace_read",
            { path: "pipeline.csv" },
            { output: JSON.stringify({ content: rows }).slice(0, 40) },
          ),
        ),
      ).toBe(true);
      // A backup copy leaves the original as it was; a copy onto it does not.
      expect(
        saves(
          write(rows),
          withInput("bash", { command: "cp pipeline.csv pipeline.csv.bak" }),
        ),
      ).toBe(true);
      expect(
        saves(
          write(rows),
          withInput("bash", { command: "cp draft.csv pipeline.csv" }),
        ),
      ).toBe(false);
      expect(
        saves(
          write(
            rows
              .replace("Acme,12000,won", 'Acme,"$12,000",won')
              .replace("Gamma,20000,open", '"Gamma, Inc",20000,open'),
          ),
        ),
      ).toBe(false);
      expect(
        saves(write(rows.replace("Acme,12000,won", 'Acme,"$12,000",won'))),
      ).toBe(true);
    });

    it("takes the last write, so an overwrite counts", () => {
      expect(saves(write(rows), write("Acme,12000,won\n"))).toBe(false);
      expect(saves(write("Acme,12000,won\n"), write(rows))).toBe(true);
    });

    it("accepts a script-written file once it is read back", () => {
      const script = withInput(
        "bash",
        { command: "python3 make_pipeline.py > pipeline.csv" },
        { exitCode: 0, stdout: "", stderr: "" },
      );
      // Written out of sight: unknown until read.
      expect(saves(script)).toBe(false);
      expect(saves(write(rows), script)).toBe(false);
      expect(
        saves(
          script,
          withInput(
            "workspace_read",
            { path: "pipeline.csv" },
            { path: "pipeline.csv", content: rows, totalChars: rows.length },
          ),
        ),
      ).toBe(true);
      expect(
        saves(
          script,
          withInput(
            "bash",
            { command: "cat pipeline.csv" },
            { exitCode: 0, stdout: rows, stderr: "" },
          ),
        ),
      ).toBe(true);
      // Written by Python or Node out of sight, until it prints the rows.
      expect(
        saves(
          withInput("bash", {
            command: "node -e \"fs.writeFileSync('pipeline.csv', data)\"",
          }),
        ),
      ).toBe(false);
      expect(
        saves(
          withInput(
            "bash",
            {
              command:
                "python3 -c \"open('pipeline.csv', 'w').write(data); print(open('pipeline.csv').read())\"",
            },
            { exitCode: 0, stdout: rows, stderr: "" },
          ),
        ),
      ).toBe(true);
    });

    it("keeps a written file when a script only reads it", () => {
      expect(
        saves(
          write(rows),
          withInput(
            "bash",
            {
              command:
                "python3 -c \"import csv; print(list(csv.reader(open('pipeline.csv'))))\"",
            },
            { exitCode: 0, stdout: "won 17000 open 35000", stderr: "" },
          ),
        ),
      ).toBe(true);
    });
  });
});
