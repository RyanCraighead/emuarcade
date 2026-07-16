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
import {
  stateCartridgeChunkUploadInputSchema,
  stateCartridgeManifestUploadInputSchema,
  stateCartridgeUrlSchema,
} from '../shared/stateCartridge';
import {
  readStateCartridgeChunk,
  readStateCartridgeManifest,
  uploadStateCartridgeChunk,
  uploadStateCartridgeManifest,
} from './stateCartridges';

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
app.post('/api/state-cartridge/chunk', async (c) => {
  try {
    const input = stateCartridgeChunkUploadInputSchema.parse(
      await c.req.json()
    );
    return c.json(await uploadStateCartridgeChunk(input));
  } catch (error) {
    console.error('Unable to upload State Cartridge chunk', error);
    return c.json({ error: getErrorMessage(error) }, 500);
  }
});
app.post('/api/state-cartridge/manifest', async (c) => {
  try {
    const input = stateCartridgeManifestUploadInputSchema.parse(
      await c.req.json()
    );
    return c.json(await uploadStateCartridgeManifest(input));
  } catch (error) {
    console.error('Unable to upload State Cartridge manifest', error);
    return c.json({ error: getErrorMessage(error) }, 500);
  }
});
app.get('/api/state-cartridge/manifest', async (c) => {
  try {
    const mediaUrl = stateCartridgeUrlSchema.parse(c.req.query('url'));
    return c.json(await readStateCartridgeManifest(mediaUrl));
  } catch (error) {
    console.error('Unable to read State Cartridge manifest', error);
    return c.json({ error: getErrorMessage(error) }, 500);
  }
});
app.get('/api/state-cartridge/chunk', async (c) => {
  try {
    const mediaUrl = stateCartridgeUrlSchema.parse(c.req.query('url'));
    const cartridge = await readStateCartridgeChunk(mediaUrl);

    return new Response(Uint8Array.from(cartridge.payload).buffer, {
      headers: {
        'Cache-Control': 'private, max-age=300',
        'Content-Length': cartridge.payload.byteLength.toString(),
        'Content-Type': 'application/octet-stream',
        'X-EmuArcade-Chunk-Count': cartridge.count.toString(),
        'X-EmuArcade-Chunk-Index': cartridge.index.toString(),
      },
    });
  } catch (error) {
    console.error('Unable to read State Cartridge chunk', error);
    return c.json({ error: getErrorMessage(error) }, 500);
  }
});
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
