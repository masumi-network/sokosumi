import { describe, expect, it } from "vitest";
import {
  type DigestibleJob,
  describeJobInput,
  digestJob,
  plainExcerpt,
} from "./job-digest";

function job(state: Partial<DigestibleJob>): DigestibleJob {
  return {
    status: "processing",
    input: null,
    inputSchema: null,
    result: null,
    events: [],
    ...state,
  };
}

describe("describeJobInput", () => {
  it("names values by the schema and humanizes the rest", () => {
    expect(
      describeJobInput(
        JSON.stringify({
          input_url: "https://nmkr.io",
          study_type: "web",
          tags: ["a", "b"],
          skipped: null,
        }),
        JSON.stringify({
          input_groups: [
            {
              input_data: [{ id: "input_url", type: "url", name: "Website" }],
            },
          ],
        }),
      ),
    ).toEqual([
      { label: "Website", value: "https://nmkr.io" },
      { label: "Study type", value: "web" },
      { label: "Tags", value: "a, b" },
    ]);
  });

  it("keeps non-JSON input as one clipped value", () => {
    const [detail] = describeJobInput("x".repeat(400), null);
    expect(detail.label).toBe("Input");
    expect(detail.value).toHaveLength(300);
  });
});

describe("plainExcerpt", () => {
  it("drops markdown syntax and clips", () => {
    expect(
      plainExcerpt("# Title\n\n**Bold** `code` [link](https://x)", 100),
    ).toBe("Title\nBold code link");
    expect(plainExcerpt("abcdef", 4)).toBe("abc…");
  });
});

describe("digestJob", () => {
  it("returns the open input request with its fields", () => {
    const schema = {
      input_data: [
        {
          id: "tone",
          type: "option",
          name: "Tone",
          data: { values: ["formal", "casual"], description: "Pick one" },
          validations: [{ validation: "optional", value: "true" }],
        },
      ],
    };
    const digest = digestJob(
      job({
        status: "input_required",
        events: [
          {
            id: "event_2",
            status: "AWAITING_INPUT",
            inputSchema: JSON.stringify(schema),
            result: null,
            blobs: [],
            links: [],
          },
        ],
      }),
    );
    expect(digest.inputRequest).toEqual({
      eventId: "event_2",
      schema,
      fields: [
        {
          id: "tone",
          type: "option",
          name: "Tone",
          description: "Pick one",
          required: false,
          options: ["formal", "casual"],
        },
      ],
    });
  });

  it("returns the result, files and links of a completed Job", () => {
    const digest = digestJob(
      job({
        status: "completed",
        result: "r".repeat(7000),
        events: [
          {
            id: "event_3",
            status: "COMPLETED",
            result: "done",
            inputSchema: null,
            blobs: [
              {
                status: "READY",
                fileUrl: "https://blob/report.pdf",
                name: "report.pdf",
                mimeType: "application/pdf",
              },
              { status: "PENDING", fileUrl: null, name: "x", mimeType: null },
            ],
            links: [{ title: "Dashboard", url: "https://dash" }],
          },
        ],
      }),
    );
    expect(digest.inputRequest).toBeNull();
    expect(digest.result).toHaveLength(6000);
    expect(digest.resultTruncated).toBe(true);
    expect(digest.files).toEqual([
      {
        name: "report.pdf",
        mimeType: "application/pdf",
        url: "https://blob/report.pdf",
      },
    ]);
    expect(digest.links).toEqual([{ title: "Dashboard", url: "https://dash" }]);
  });

  it("explains a failure", () => {
    const digest = digestJob(
      job({
        status: "failed",
        events: [
          {
            id: "event_4",
            status: "FAILED",
            result: "Site blocked the crawler",
            inputSchema: null,
            blobs: [],
            links: [],
          },
        ],
      }),
    );
    expect(digest.error).toBe("Site blocked the crawler");
  });
});
