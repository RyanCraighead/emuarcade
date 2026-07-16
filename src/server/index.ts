import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { handleTrpcRequest } from './trpc';
import { clipShareInputSchema } from '../shared/trpc';
import { shareClip } from './clips';
import {
  sharedStateCommentInputSchema,
  sharedStateShareInputSchema,
} from '../shared/sharedState';
import { shareState, shareStateComment } from './shares';

const app = new Hono();
const internal = new Hono();

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unknown server error';
};

internal.route('/menu', menu);
internal.route('/triggers', triggers);

app.use('/api/trpc/*', async (c) => {
  return await handleTrpcRequest(c.req.raw);
});
app.post('/api/share-clip', async (c) => {
  try {
    const input = clipShareInputSchema.parse(await c.req.json());
    const result = await shareClip(input);

    return c.json(result);
  } catch (error) {
    console.error('Unable to share clip', error);

    return c.json({ error: getErrorMessage(error) }, 500);
  }
});
app.post('/api/share-state', async (c) => {
  try {
    const input = sharedStateShareInputSchema.parse(await c.req.json());
    const result = await shareState(input);

    return c.json(result);
  } catch (error) {
    console.error('Unable to share save state', error);

    return c.json({ error: getErrorMessage(error) }, 500);
  }
});
app.post('/api/share-state-comment', async (c) => {
  try {
    const input = sharedStateCommentInputSchema.parse(await c.req.json());
    const result = await shareStateComment(input);

    return c.json(result);
  } catch (error) {
    console.error('Unable to share save-state comment', error);

    return c.json({ error: getErrorMessage(error) }, 500);
  }
});
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
