import { NextResponse } from "next/server";
import { z } from "zod";

import { calculateCreditCost } from "@/lib/db/services/credit.service";

const creditCalculationSchema = z.object({
  amounts: z.array(
    z.object({
      unit: z.string(),
      amount: z.number({ coerce: true }).positive(),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = creditCalculationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: result.error.errors }, { status: 400 });
    }
    const { amounts } = result.data;

    const totalCost = await calculateCreditCost(amounts);
    console.log(totalCost);

    return NextResponse.json({ totalCost: totalCost.toString() });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
