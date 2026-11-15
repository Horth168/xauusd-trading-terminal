import type { AnalysisContext } from './context';
import { indicatorAgent, mtfAgent, riskAgent, smcAgent, structureAgent } from './agents';
import type { AgentReport, MarketSnapshot, Side, TradePlan } from './types';

/** Runs the five specialists for one proposed side (or neutrally when side is null). */
export function agentsFor(ctx: AnalysisContext, side: Side | null, plan: TradePlan | null, mkt: MarketSnapshot): AgentReport[] {
  return [mtfAgent(ctx, side), structureAgent(ctx, side), indicatorAgent(ctx, side), smcAgent(ctx, side), riskAgent(ctx, side, plan, mkt)];
}
