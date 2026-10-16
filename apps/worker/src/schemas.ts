import { EXPENSE_CATEGORIES, SUPPORTED_CURRENCIES } from '@line-split/core';
import { z } from 'zod';

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');
const currency = z.string().refine((c) => SUPPORTED_CURRENCIES.includes(c), 'unsupported currency');
const memberId = z.string().min(1).max(64);
const timestamp = z.number().int().positive();

const split = z.discriminatedUnion('type', [
  z.object({ type: z.literal('equal'), memberIds: z.array(memberId).min(1).max(100) }),
  z.object({
    type: z.literal('weights'),
    items: z.array(z.object({ memberId, weight: z.number().int().min(0).max(1_000_000) })).min(1).max(100),
  }),
  z.object({
    type: z.literal('exact'),
    items: z.array(z.object({ memberId, amount: decimal })).min(1).max(100),
  }),
]);

export const expenseSchema = z.object({
  title: z.string().trim().min(1).max(100),
  currency,
  amount: decimal,
  /** Omit to use today's auto rate; ignored when currency equals the base currency. */
  fxRate: decimal.optional(),
  spentAt: timestamp.optional(),
  category: z.enum(EXPENSE_CATEGORIES).nullable().optional(),
  payers: z.array(z.object({ memberId, amount: decimal })).min(1).max(100),
  split,
});
export type ExpenseBody = z.infer<typeof expenseSchema>;

export const expenseUpdateSchema = expenseSchema.extend({ revision: z.string().min(1) });

export const settlementSchema = z.object({
  fromMemberId: memberId,
  toMemberId: memberId,
  /** In the ledger's base currency. */
  amount: decimal,
  settledAt: timestamp.optional(),
});
export type SettlementBody = z.infer<typeof settlementSchema>;

export const ledgerPatchSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  baseCurrency: currency.optional(),
});

export const nextLedgerSchema = z.object({
  name: z.string().trim().min(1).max(50),
  /** Members of the previous ledger to carry over; omit for everyone. The starter is always included. */
  memberIds: z.array(memberId).max(100).optional(),
});

export const paymentInfoSchema = z.object({
  /** Free text such as a bank account or LINE Pay handle; empty clears it. */
  info: z.string().trim().max(200),
});

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'] as const;
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'done', 'wont_fix'] as const;

export const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().trim().min(1).max(1000),
  ledgerId: z.string().max(64).optional(),
  /** Diagnostic hints from the client (page, user agent…), capped in size. */
  context: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .refine((c) => JSON.stringify(c).length <= 2000, 'context too large')
    .optional(),
});
export type FeedbackBody = z.infer<typeof feedbackSchema>;

export const feedbackStatusSchema = z.enum(FEEDBACK_STATUSES);

export const feedbackPatchSchema = z.object({
  status: feedbackStatusSchema.optional(),
  adminNote: z.string().trim().max(1000).nullable().optional(),
  /** Also push the status / reply to the submitter's chat with the bot. */
  notify: z.boolean().optional(),
});

export const fxQuerySchema = z.object({ from: currency, to: currency });
