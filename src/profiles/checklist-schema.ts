/**
 * Zod schema for evaluator.checklist — validates profile JSON at load time.
 */

import { z } from 'zod';

export const HardCheckItem = z.object({
  id: z.string().regex(/^H\d+$/),
  title: z.string().min(1),
  passDescription: z.string().min(1),
  failReworkDescription: z.string().min(1),
  failEscalateDescription: z.string().min(1),
});

export const SoftCheckItem = z.object({
  id: z.string().regex(/^S\d+$/),
  title: z.string().min(1),
  weight: z.number().min(0).max(1),
  scoringGuide: z.string().min(1),
});

export const EvalChecklist = z.object({
  hard: z.array(HardCheckItem).min(1),
  soft: z.array(SoftCheckItem).min(1),
});

export type HardCheckItemType = z.infer<typeof HardCheckItem>;
export type SoftCheckItemType = z.infer<typeof SoftCheckItem>;
export type EvalChecklistType = z.infer<typeof EvalChecklist>;
