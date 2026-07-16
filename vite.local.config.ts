import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import { appRouter, clipShareInputSchema } from './src/shared/trpc';
import type { ClipShareResult } from './src/shared/emulator';
import type { TrpcContext } from './src/shared/trpc';
import {
  MAX_SHARED_POST_DATA_BYTES,
  measurePostDataBytes,
  sharedStateCommentInputSchema,
  sharedStateShareInputSchema,
  withSharedStatePreview,
} from './src/shared/sharedState';
import type {
  SharedStatePostData,
  SharedStateShareResult,
} from './src/shared/sharedState';
import {
  calculateStateCartridgeSha256,
  decodeStateCartridgeBase64,
  decodeStateCartridgeManifest,
  decodeStateCartridgePng,
  encodeStateCartridgeManifest,
  encodeStateCartridgePng,
  joinStateCartridgePayload,
  stateCartridgeChunkUploadInputSchema,
  stateCartridgeManifestUploadInputSchema,
} from './src/shared/stateCartridge';

type LocalClip = {
  buffer: Buffer;
  core: string;
  durationMs: number;
  gameTitle: string;
  mimeType: string;
  shareKind: ClipShareResult['shareKind'];
  sizeBytes: number;
};

type LocalSharedState = {
  mediaBuffer: Buffer | null;
  mediaMimeType: string | null;
  postData: SharedStatePostData;
};

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const localClipStore = new Map<string, LocalClip>();
const localSharedStateStore = new Map<string, LocalSharedState>();
const localStateCartridgeStore = new Map<string, Buffer>();
let localLaunchCount = 0;
let localViewerSeen = false;

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown
) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
};

const sendNotFound = (response: ServerResponse) => {
  response.statusCode = 404;
  response.end('Not found');
};

const readRequestText = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const readRequestJson = async (request: IncomingMessage) => {
  return JSON.parse(await readRequestText(request));
};

const parseDataUrl = (dataUrl: string) => {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);

  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const isBase64 = Boolean(match[2]);
  const payload = match[3];

  if (!mimeType || !payload) {
    return null;
  }

  return {
    buffer: isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload)),
    mimeType,
  };
};

const getLocalStateCartridge = (mediaUrl: string) => {
  const url = new URL(mediaUrl);
  const match = /^\/api\/local-cartridges\/([a-z0-9]+)$/i.exec(url.pathname);
  const id = match?.[1];

  return id ? (localStateCartridgeStore.get(id) ?? null) : null;
};

const createLocalTrpcContext = (): TrpcContext => {
  return {
    getAppInfo: async () => {
      return {
        username: 'local-player',
        subredditName: 'local-dev',
        postId: 'local-post',
        launchCount: localLaunchCount,
      };
    },
    getViewerState: async () => {
      const isNewPlayer = !localViewerSeen;

      localViewerSeen = true;

      return {
        isAuthenticated: true,
        isNewPlayer,
      };
    },
    recordLaunch: async () => {
      localLaunchCount += 1;

      return { launchCount: localLaunchCount };
    },
    shareClip: async () => {
      throw new Error('Use /api/share-clip in local mode');
    },
  };
};

const sendLocalHtml = async (
  server: ViteDevServer,
  response: ServerResponse,
  routePath: string,
  sourceFile: string,
  modulePath: string
) => {
  const htmlPath = path.join(projectRoot, 'src', 'client', sourceFile);
  const html = (await readFile(htmlPath, 'utf8')).replace(
    `src="${modulePath}"`,
    `src="/src/client/${modulePath}"`
  );
  const transformedHtml = await server.transformIndexHtml(routePath, html);

  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html');
  response.end(transformedHtml);
};

const sendClipPage = (response: ServerResponse, id: string, clip: LocalClip) => {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${clip.gameTitle} clip</title>
    <style>
      html, body {
        background: #070809;
        color: #f7f3ea;
        font-family: system-ui, sans-serif;
        height: 100%;
        margin: 0;
      }
      body {
        display: grid;
        gap: 16px;
        place-content: center;
        padding: 24px;
      }
      main {
        display: grid;
        gap: 12px;
        width: min(860px, 100%);
      }
      video,
      img {
        aspect-ratio: 16 / 9;
        background: #000;
        border: 1px solid #2f332f;
        border-radius: 6px;
        width: 100%;
      }
      p {
        color: #c9c1ad;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${clip.gameTitle}</h1>
      ${
        clip.shareKind === 'gif'
          ? `<img src="/local-clips/${id}/clip" alt="${clip.gameTitle} clip" />`
          : `<video src="/local-clips/${id}/clip" controls autoplay loop playsinline></video>`
      }
      <p>${clip.core.toUpperCase()} - ${Math.round(clip.durationMs / 1000)}s - ${Math.round(clip.sizeBytes / 1024)} KB</p>
    </main>
  </body>
</html>`);
};

const localDevServerPlugin = (): Plugin => {
  return {
    name: 'emuarcade-local-dev-server',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(
          request.url ?? '/',
          'http://emuarcade.local'
        );
        const routePath = requestUrl.pathname;

        try {
          if (routePath === '/' || routePath === '/splash.html') {
            await sendLocalHtml(
              server,
              response,
              routePath,
              'splash.html',
              'splash.tsx'
            );
            return;
          }

          if (routePath === '/game.html') {
            await sendLocalHtml(
              server,
              response,
              routePath,
              'game.html',
              'game.tsx'
            );
            return;
          }

          if (routePath === '/shared.html') {
            await sendLocalHtml(
              server,
              response,
              routePath,
              'shared.html',
              'shared.tsx'
            );
            return;
          }

          if (routePath.startsWith('/api/trpc/')) {
            await nodeHTTPRequestHandler({
              router: appRouter,
              req: request,
              res: response,
              path: routePath.slice('/api/trpc/'.length),
              createContext: createLocalTrpcContext,
            });
            return;
          }

          if (routePath === '/api/share-clip' && request.method === 'POST') {
            const input = clipShareInputSchema.parse(
              await readRequestJson(request)
            );
            const parsedClip = parseDataUrl(input.dataUrl);

            if (!parsedClip) {
              sendJson(response, 400, { error: 'Invalid clip data URL' });
              return;
            }

            const clipId = crypto.randomUUID();
            const postUrl = `/local-clips/${clipId}`;
            const result: ClipShareResult = {
              mediaUrl: `${postUrl}/clip`,
              postId: null,
              postUrl,
              subredditName: 'local-dev',
              shareKind: input.shareFormat,
            };

            localClipStore.set(clipId, {
              buffer: parsedClip.buffer,
              core: input.core,
              durationMs: input.durationMs,
              gameTitle: input.gameTitle,
              mimeType: parsedClip.mimeType,
              shareKind: result.shareKind,
              sizeBytes: input.sizeBytes,
            });
            sendJson(response, 200, result);
            return;
          }

          if (routePath === '/api/share-state' && request.method === 'POST') {
            const input = sharedStateShareInputSchema.parse(
              await readRequestJson(request)
            );
            const shareId = crypto.randomUUID().replace(/-/g, '');
            const parsedPreview = input.previewDataUrl
              ? parseDataUrl(input.previewDataUrl)
              : null;
            const host = request.headers.host ?? '127.0.0.1:5174';
            const mediaUrl = parsedPreview
              ? `http://${host}/api/local-shares/${shareId}/media`
              : null;
            const postData = withSharedStatePreview(
              input.postData,
              mediaUrl,
              input.previewKind
            );
            const postDataBytes = measurePostDataBytes(postData);

            if (postDataBytes > MAX_SHARED_POST_DATA_BYTES) {
              sendJson(response, 400, {
                error: `Save state needs ${postDataBytes} post-data bytes`,
              });
              return;
            }

            localSharedStateStore.set(shareId, {
              mediaBuffer: parsedPreview?.buffer ?? null,
              mediaMimeType: parsedPreview?.mimeType ?? null,
              postData,
            });

            const result: SharedStateShareResult = {
              mediaUrl,
              postDataBytes,
              postId: `t3_${shareId}`,
              postUrl: `/shared.html?localShare=${shareId}`,
              subredditName: 'local-dev',
            };

            sendJson(response, 200, result);
            return;
          }

          if (
            routePath === '/api/state-cartridge/chunk' &&
            request.method === 'POST'
          ) {
            const input = stateCartridgeChunkUploadInputSchema.parse(
              await readRequestJson(request)
            );
            const payload = decodeStateCartridgeBase64(input.data);
            const png = encodeStateCartridgePng(payload, {
              kind: 'chunk',
              index: input.index,
              count: input.count,
            });
            const id = crypto.randomUUID().replace(/-/g, '');
            const host = request.headers.host ?? '127.0.0.1:5174';
            const mediaUrl = `http://${host}/api/local-cartridges/${id}`;

            localStateCartridgeStore.set(id, Buffer.from(png));
            sendJson(response, 200, {
              u: mediaUrl,
              z: payload.byteLength,
              h: await calculateStateCartridgeSha256(payload),
            });
            return;
          }

          if (
            routePath === '/api/state-cartridge/manifest' &&
            request.method === 'POST'
          ) {
            const manifest = stateCartridgeManifestUploadInputSchema.parse(
              await readRequestJson(request)
            );
            const payloads: Uint8Array[] = [];

            for (let index = 0; index < manifest.chunks.length; index += 1) {
              const reference = manifest.chunks[index];
              const png = reference
                ? getLocalStateCartridge(reference.u)
                : null;

              if (!reference || !png) {
                throw new Error('Local State Cartridge chunk is missing');
              }

              const decoded = decodeStateCartridgePng(png);

              if (
                decoded.kind !== 'chunk' ||
                decoded.index !== index ||
                decoded.count !== manifest.chunks.length ||
                decoded.payload.byteLength !== reference.z ||
                (await calculateStateCartridgeSha256(decoded.payload)) !==
                  reference.h
              ) {
                throw new Error('Local State Cartridge chunk is invalid');
              }

              payloads.push(decoded.payload);
            }

            const completePayload = joinStateCartridgePayload(
              payloads,
              manifest.n
            );

            if (
              (await calculateStateCartridgeSha256(completePayload)) !==
              manifest.h
            ) {
              throw new Error('Local State Cartridge payload is invalid');
            }

            const manifestPayload = encodeStateCartridgeManifest(manifest);
            const png = encodeStateCartridgePng(manifestPayload, {
              kind: 'manifest',
            });
            const id = crypto.randomUUID().replace(/-/g, '');
            const host = request.headers.host ?? '127.0.0.1:5174';
            const mediaUrl = `http://${host}/api/local-cartridges/${id}`;

            localStateCartridgeStore.set(id, Buffer.from(png));
            sendJson(response, 200, { mediaUrl });
            return;
          }

          if (
            routePath === '/api/state-cartridge/manifest' &&
            request.method === 'GET'
          ) {
            const mediaUrl = requestUrl.searchParams.get('url');
            const png = mediaUrl ? getLocalStateCartridge(mediaUrl) : null;

            if (!png) {
              sendNotFound(response);
              return;
            }

            const decoded = decodeStateCartridgePng(png);

            if (decoded.kind !== 'manifest') {
              throw new Error('Local State Cartridge is not a manifest');
            }

            sendJson(
              response,
              200,
              decodeStateCartridgeManifest(decoded.payload)
            );
            return;
          }

          if (
            routePath === '/api/state-cartridge/chunk' &&
            request.method === 'GET'
          ) {
            const mediaUrl = requestUrl.searchParams.get('url');
            const png = mediaUrl ? getLocalStateCartridge(mediaUrl) : null;

            if (!png) {
              sendNotFound(response);
              return;
            }

            const decoded = decodeStateCartridgePng(png);

            if (decoded.kind !== 'chunk') {
              throw new Error('Local State Cartridge is not a chunk');
            }

            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/octet-stream');
            response.setHeader('Content-Length', decoded.payload.byteLength);
            response.setHeader(
              'X-EmuArcade-Chunk-Count',
              decoded.count.toString()
            );
            response.setHeader(
              'X-EmuArcade-Chunk-Index',
              decoded.index.toString()
            );
            response.end(Buffer.from(decoded.payload));
            return;
          }

          if (routePath.startsWith('/api/local-cartridges/')) {
            const id = routePath.split('/').at(-1);
            const png = id ? localStateCartridgeStore.get(id) : null;

            if (!png) {
              sendNotFound(response);
              return;
            }

            response.statusCode = 200;
            response.setHeader('Content-Type', 'image/png');
            response.setHeader('Content-Length', png.byteLength);
            response.end(png);
            return;
          }

          if (
            routePath === '/api/share-state-comment' &&
            request.method === 'POST'
          ) {
            const input = sharedStateCommentInputSchema.parse(
              await readRequestJson(request)
            );

            sendJson(response, 200, {
              commentId: `t1_${input.postId.slice(3)}`,
            });
            return;
          }

          if (routePath.startsWith('/api/local-shares/')) {
            const [, , , shareId, action] = routePath.split('/');
            const sharedState = shareId
              ? localSharedStateStore.get(shareId)
              : undefined;

            if (!sharedState) {
              sendNotFound(response);
              return;
            }

            if (action === 'media') {
              if (!sharedState.mediaBuffer || !sharedState.mediaMimeType) {
                sendNotFound(response);
                return;
              }

              response.statusCode = 200;
              response.setHeader('Content-Type', sharedState.mediaMimeType);
              response.setHeader(
                'Content-Length',
                sharedState.mediaBuffer.byteLength
              );
              response.end(sharedState.mediaBuffer);
              return;
            }

            sendJson(response, 200, sharedState.postData);
            return;
          }

          if (routePath.startsWith('/local-clips/')) {
            const [, , clipId, action] = routePath.split('/');
            const clip = clipId ? localClipStore.get(clipId) : undefined;

            if (!clip || !clipId) {
              sendNotFound(response);
              return;
            }

            if (action === 'clip') {
              response.statusCode = 200;
              response.setHeader('Content-Type', clip.mimeType);
              response.setHeader('Content-Length', clip.buffer.byteLength);
              response.end(clip.buffer);
              return;
            }

            sendClipPage(response, clipId, clip);
            return;
          }
        } catch (error) {
          console.error('Local dev server error', error);
          sendJson(response, 500, {
            error:
              error instanceof Error ? error.message : 'Local server error',
          });
          return;
        }

        next();
      });
    },
  };
};

export default defineConfig({
  plugins: [react(), tailwind(), localDevServerPlugin()],
  resolve: {
    alias: {
      '@devvit/web/client': path.join(
        projectRoot,
        'src',
        'client',
        'local',
        'devvitClient.ts'
      ),
    },
  },
});
