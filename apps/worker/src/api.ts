import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from './env';
import { HttpError } from './errors';
import { getFxRate } from './fx';
import { verifyIdToken } from './line/idToken';
import {
  expenseSchema,
  expenseUpdateSchema,
  feedbackPatchSchema,
  feedbackSchema,
  feedbackStatusSchema,
  fxQuerySchema,
  ledgerPatchSchema,
  nextLedgerSchema,
  paymentInfoSchema,
  settlementSchema,
} from './schemas';
import { createExpense, deleteExpense, listExpenses, updateExpense } from './services/expenses';
import {
  closeLedger,
  findLedger,
  findMemberByLineUser,
  findOpenLedgerByGroup,
  hasLedgerActivity,
  listGroupLedgers,
  listMembers,
  startNextLedger,
  updateLedger,
  upsertLineMember,
  type LedgerRow,
  type MemberRow,
} from './services/ledgers';
import { LineClient } from './line/client';
import { adminFeedbackUrl, feedbackUrl } from './line/messages';
import {
  createFeedback,
  feedbackNotice,
  feedbackSubmitter,
  replyNotice,
  listAllFeedback,
  listMyFeedback,
  toPublicFeedback,
  updateFeedback,
} from './services/feedback';
import { listAudit } from './services/audit';
import { getPaymentInfo, setPaymentInfo } from './services/payments';
import { getUsage } from './services/usage';
import { createSettlement, deleteSettlement, getSummary, listSettlements } from './services/settlements';

type Ctx = Context<AppEnv>;

async function parseJson<T extends z.ZodTypeAny>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new HttpError(400, `${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return parsed.data;
}

interface LedgerScope {
  ledger: LedgerRow;
  members: MemberRow[];
  me: MemberRow;
}

/** Loads the ledger and asserts the caller is a member of it. */
async function requireMember(c: Ctx): Promise<LedgerScope> {
  const ledger = await findLedger(c.env.DB, c.req.param('ledgerId')!);
  if (!ledger) throw new HttpError(404, 'Ledger not found');
  const members = await listMembers(c.env.DB, ledger.id);
  const me = members.find((m) => m.line_user_id === c.get('user').lineUserId);
  if (!me) throw new HttpError(403, 'Not a member of this ledger');
  return { ledger, members, me };
}

/** Rejects writes to a closed (finished) ledger. */
function requireOpen(scope: LedgerScope): LedgerScope {
  if (scope.ledger.closed_at !== null) throw new HttpError(409, 'This ledger is closed and read-only');
  return scope;
}

async function ledgerView(db: D1Database, { ledger, members, me }: LedgerScope) {
  const open =
    ledger.closed_at === null ? ledger : ledger.line_group_id ? await findOpenLedgerByGroup(db, ledger.line_group_id) : null;
  return {
    ledger: {
      id: ledger.id,
      name: ledger.name,
      baseCurrency: ledger.base_currency,
      archived: ledger.archived_at !== null,
      closedAt: ledger.closed_at,
      /** The group's current open ledger (this one unless it is closed). */
      activeLedgerId: open?.id ?? null,
    },
    members: members.map((m) => ({
      id: m.id,
      displayName: m.display_name,
      avatarUrl: m.avatar_url,
      isVirtual: m.is_virtual === 1,
      paymentInfo: m.payment_info ?? null,
    })),
    meMemberId: me.id,
  };
}

export const api = new Hono<AppEnv>();

api.use('*', async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Missing ID token');
  const claims = await verifyIdToken(header.slice('Bearer '.length), c.env.LINE_LOGIN_CHANNEL_ID);
  c.set('user', {
    lineUserId: claims.sub,
    displayName: claims.name ?? 'LINE 使用者',
    pictureUrl: claims.picture ?? null,
  });
  await next();
});

/**
 * Idempotent: anyone holding an open ledger's link can join; closed ledgers
 * only admit their existing members. Refreshes name/avatar.
 */
api.post('/ledgers/:ledgerId/join', async (c) => {
  const ledger = await findLedger(c.env.DB, c.req.param('ledgerId'));
  if (!ledger) throw new HttpError(404, 'Ledger not found');
  const user = c.get('user');
  if (ledger.closed_at !== null && !(await findMemberByLineUser(c.env.DB, ledger.id, user.lineUserId))) {
    throw new HttpError(403, 'Not a member of this closed ledger');
  }
  const me = await upsertLineMember(c.env.DB, ledger.id, user.lineUserId, user);
  const members = await listMembers(c.env.DB, ledger.id);
  return c.json(await ledgerView(c.env.DB, { ledger, members, me }));
});

api.get('/ledgers/:ledgerId', async (c) => c.json(await ledgerView(c.env.DB, await requireMember(c))));

/** Change history of expenses and repayments; readable by every member, open or closed. */
api.get('/ledgers/:ledgerId/audit', async (c) => {
  const { ledger } = await requireMember(c);
  return c.json({ baseCurrency: ledger.base_currency, entries: await listAudit(c.env.DB, ledger.id) });
});

api.get('/ledgers/:ledgerId/history', async (c) => {
  const { ledger } = await requireMember(c);
  const ledgers = ledger.line_group_id
    ? await listGroupLedgers(c.env.DB, ledger.line_group_id, c.get('user').lineUserId)
    : [];
  return c.json({ ledgers });
});

/**
 * Finishes this ledger; it becomes read-only. Only allowed once everyone is
 * settled, since a closed ledger can no longer record repayments. A new
 * ledger is started separately.
 */
api.post('/ledgers/:ledgerId/close', async (c) => {
  const scope = requireOpen(await requireMember(c));
  const { transfers } = await getSummary(c.env.DB, scope.ledger, scope.members);
  if (transfers.length > 0) {
    throw new HttpError(409, `Ledger has ${transfers.length} unsettled transfer(s); settle up before closing`);
  }
  if (!(await closeLedger(c.env.DB, scope.ledger.id))) throw new HttpError(409, 'This ledger is closed and read-only');
  return c.json(await ledgerView(c.env.DB, { ...scope, ledger: (await findLedger(c.env.DB, scope.ledger.id))! }));
});

/** Starts the group's next ledger from this one, carrying over the chosen members. */
api.post('/ledgers/:ledgerId/next', async (c) => {
  const { ledger, members: previous } = await requireMember(c);
  const { name, memberIds } = await parseJson(c, nextLedgerSchema);
  if (!ledger.line_group_id) throw new HttpError(409, 'Only group ledgers can start a new ledger');
  const known = new Set(previous.map((m) => m.id));
  const unknown = memberIds?.find((id) => !known.has(id));
  if (unknown) throw new HttpError(400, `Unknown member: ${unknown}`);

  const nextId = await startNextLedger(c.env.DB, ledger, name, {
    memberIds,
    starterLineUserId: c.get('user').lineUserId,
  });
  if (!nextId) throw new HttpError(409, 'The group already has an open ledger');

  const next = (await findLedger(c.env.DB, nextId))!;
  const members = await listMembers(c.env.DB, nextId);
  const me = members.find((m) => m.line_user_id === c.get('user').lineUserId)!;
  return c.json(await ledgerView(c.env.DB, { ledger: next, members, me }), 201);
});

api.patch('/ledgers/:ledgerId', async (c) => {
  const scope = requireOpen(await requireMember(c));
  const patch = await parseJson(c, ledgerPatchSchema);
  if (
    patch.baseCurrency &&
    patch.baseCurrency !== scope.ledger.base_currency &&
    (await hasLedgerActivity(c.env.DB, scope.ledger.id))
  ) {
    throw new HttpError(409, 'Base currency cannot change once expenses or settlements exist');
  }
  await updateLedger(c.env.DB, scope.ledger.id, patch);
  return c.json(await ledgerView(c.env.DB, { ...scope, ledger: (await findLedger(c.env.DB, scope.ledger.id))! }));
});

api.get('/ledgers/:ledgerId/expenses', async (c) => {
  const { ledger } = await requireMember(c);
  return c.json({ expenses: await listExpenses(c.env.DB, ledger.id) });
});

api.post('/ledgers/:ledgerId/expenses', async (c) => {
  const { ledger, members, me } = requireOpen(await requireMember(c));
  const body = await parseJson(c, expenseSchema);
  return c.json(await createExpense(c.env.DB, ledger, members, me, body), 201);
});

api.put('/ledgers/:ledgerId/expenses/:expenseId', async (c) => {
  const { ledger, members, me } = requireOpen(await requireMember(c));
  const { revision, ...body } = await parseJson(c, expenseUpdateSchema);
  return c.json(await updateExpense(c.env.DB, ledger, members, me, c.req.param('expenseId'), revision, body));
});

api.delete('/ledgers/:ledgerId/expenses/:expenseId', async (c) => {
  const { ledger, me } = requireOpen(await requireMember(c));
  await deleteExpense(c.env.DB, ledger, me, c.req.param('expenseId'));
  return c.body(null, 204);
});

api.get('/ledgers/:ledgerId/summary', async (c) => {
  const { ledger, members } = await requireMember(c);
  return c.json(await getSummary(c.env.DB, ledger, members));
});

api.get('/ledgers/:ledgerId/settlements', async (c) => {
  const { ledger } = await requireMember(c);
  return c.json({ settlements: await listSettlements(c.env.DB, ledger.id) });
});

api.post('/ledgers/:ledgerId/settlements', async (c) => {
  const { ledger, members, me } = requireOpen(await requireMember(c));
  const body = await parseJson(c, settlementSchema);
  return c.json(await createSettlement(c.env.DB, ledger, members, me, body), 201);
});

api.delete('/ledgers/:ledgerId/settlements/:settlementId', async (c) => {
  const { ledger, me } = requireOpen(await requireMember(c));
  await deleteSettlement(c.env.DB, ledger, me, c.req.param('settlementId'));
  return c.body(null, 204);
});

function adminIds(c: Ctx): string[] {
  return (c.env.ADMIN_LINE_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function requireAdmin(c: Ctx): void {
  if (!adminIds(c).includes(c.get('user').lineUserId)) throw new HttpError(403, 'Admins only');
}

api.get('/me', (c) => c.json({ isAdmin: adminIds(c).includes(c.get('user').lineUserId) }));

api.post('/feedback', async (c) => {
  const body = await parseJson(c, feedbackSchema);
  const feedback = await createFeedback(c.env.DB, c.get('user'), body);

  const admins = adminIds(c);
  if (c.env.FEEDBACK_PUSH === 'on' && admins.length > 0) {
    // Notify in the background; a failed push (e.g. quota) must not lose the feedback.
    const line = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const text = feedbackNotice(feedback, adminFeedbackUrl(c.env.LIFF_ID));
    c.executionCtx.waitUntil(
      Promise.all(admins.map((to) => line.push(to, [{ type: 'text', text }]))).catch((err) =>
        console.error('Failed to push feedback notice', err),
      ),
    );
  }

  return c.json(toPublicFeedback(feedback), 201);
});

api.get('/feedback/mine', async (c) => c.json({ feedback: await listMyFeedback(c.env.DB, c.get('user').lineUserId) }));

api.get('/admin/feedback', async (c) => {
  requireAdmin(c);
  const raw = c.req.query('status');
  const status = raw === undefined ? undefined : feedbackStatusSchema.safeParse(raw);
  if (status && !status.success) throw new HttpError(400, 'Unknown status');
  return c.json({ feedback: await listAllFeedback(c.env.DB, status?.data) });
});

/**
 * Updates status / reply. With `notify`, the result is pushed to the submitter
 * synchronously so the admin learns whether it went out; a failed push (quota,
 * blocked bot) never rolls back the update.
 */
api.patch('/admin/feedback/:id', async (c) => {
  requireAdmin(c);
  const { notify, ...patch } = await parseJson(c, feedbackPatchSchema);
  const updated = await updateFeedback(c.env.DB, c.req.param('id'), patch);

  let notified = false;
  if (notify) {
    const to = await feedbackSubmitter(c.env.DB, updated.id);
    try {
      if (to) {
        const text = replyNotice(updated, feedbackUrl(c.env.LIFF_ID));
        await new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN).push(to, [{ type: 'text', text }]);
        notified = true;
      }
    } catch (err) {
      console.error('Failed to push feedback reply', err);
    }
  }
  return c.json({ ...updated, notified });
});

api.get('/admin/usage', async (c) => {
  requireAdmin(c);
  return c.json(await getUsage(c.env.DB, new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN)));
});

/** The caller's own payment details; nobody can read or change another user's here. */
api.get('/me/payment-info', async (c) => c.json({ info: await getPaymentInfo(c.env.DB, c.get('user').lineUserId) }));

api.put('/me/payment-info', async (c) => {
  const { info } = await parseJson(c, paymentInfoSchema);
  return c.json({ info: await setPaymentInfo(c.env.DB, c.get('user').lineUserId, info) });
});

api.get('/fx', async (c) => {
  const parsed = fxQuerySchema.safeParse(c.req.query());
  if (!parsed.success) throw new HttpError(400, 'from and to must be supported currencies');
  return c.json(await getFxRate(c.env.DB, parsed.data.from, parsed.data.to));
});
