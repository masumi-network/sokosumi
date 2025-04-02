import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { startJob } from "@/lib/db/services/job.service";

const inputSchema = z.object({
  agentId: z.string(),
  maxAcceptedCreditCost: z.number(),
  inputData: z.record(
    z.string(),
    z.number().or(z.string()).or(z.boolean()).or(z.array(z.number())),
  ),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await request.headers,
  });
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const requestJson = await request.json();
  const result = inputSchema.safeParse(requestJson);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data = result.data;

  const job = await startJob(
    session.user.id,
    data.agentId,
    BigInt(data.maxAcceptedCreditCost),
    new Map(Object.entries(data.inputData)),
  );
  return NextResponse.json({ jobId: job.id }, { status: 200 });
}
