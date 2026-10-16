import { Hono, type ErrorHandler } from 'hono';
import { api } from './api';
import type { AppEnv } from './env';
import { HttpError } from './errors';
import { webhookHandler } from './webhook';

const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal Server Error' }, 500);
};

api.onError(onError);

// strict: false so "/webhook/" (common when pasting into LINE Console) also matches.
const app = new Hono<AppEnv>({ strict: false });
app.onError(onError);
app.get('/health', (c) => c.json({ ok: true }));
app.post('/webhook', webhookHandler);
app.route('/api', api);

export default app;
