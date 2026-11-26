/**
 * One turn's input-token allowance, shared by every model call made for it:
 * its parts, the main loop, retries and run_subagent's helper. A step is
 * admitted before it runs and holds a reservation the size of the largest
 * step so far, so calls running at once see each other's spend.
 */
export interface TurnTokenBudget {
  limit: number;
  used: number;
  reserved: number;
  /** Input tokens of the largest step so far; the prompt's size before one. */
  perStep: number;
}

export function turnTokenBudget(
  limit: number,
  firstStepEstimate: number,
): TurnTokenBudget {
  return {
    limit,
    used: 0,
    reserved: 0,
    perStep: Math.max(0, firstStepEstimate),
  };
}

/** A prompt's input tokens before a step has measured them: about 4 chars each. */
export function estimateInputTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4);
}

/**
 * Admission for one model call's steps. `admit` is synchronous, so two
 * calls running side by side cannot both take the last room.
 */
export class StepAdmission {
  private held = 0;
  private holding = false;

  constructor(private readonly budget: TurnTokenBudget | undefined) {}

  /** Reserves room for the next step; false once the turn's allowance is spent. */
  admit(): boolean {
    const budget = this.budget;
    if (!budget || this.holding) return true;
    if (budget.used + budget.reserved + budget.perStep > budget.limit)
      return false;
    budget.reserved += budget.perStep;
    this.held = budget.perStep;
    this.holding = true;
    return true;
  }

  /** Books a finished step, admitted or not (a wrap-up is never refused). */
  settle(inputTokens: number | undefined): void {
    const budget = this.budget;
    if (!budget) return;
    const spent = inputTokens ?? 0;
    budget.reserved -= this.held;
    budget.used += spent;
    budget.perStep = Math.max(budget.perStep, spent);
    this.held = 0;
    this.holding = false;
  }

  /** Gives back a reservation no step used (the call stopped for another reason). */
  release(): void {
    if (!this.budget) return;
    this.budget.reserved -= this.held;
    this.held = 0;
    this.holding = false;
  }
}
