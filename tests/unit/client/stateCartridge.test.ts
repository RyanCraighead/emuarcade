import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STATE_CARTRIDGE_CHUNK_BYTES,
  calculateStateCartridgeSha256,
  decodeStateCartridgeBase64,
  joinStateCartridgePayload,
  stateCartridgeBytesEqual,
  stateCartridgeChunkUploadInputSchema,
  stateCartridgeManifestSchema,
} from '../../../src/shared/stateCartridge';
import type {
  StateCartridgeChunkRef,
  StateCartridgeManifest,
} from '../../../src/shared/stateCartridge';
import type { SharedStatePostData } from '../../../src/shared/sharedState';
import {
  downloadStateCartridge,
  uploadStateCartridge,
} from '../../../src/client/stateCartridge';

const createPayload = (length: number) => {
  const payload = new Uint8Array(length);
  let state = 0x7f4a7c15;

  for (let index = 0; index < payload.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    payload[index] = state & 0xff;
  }

  return payload;
};

const createPostData = (
  manifestUrl: string,
  compressedBytes: number
): SharedStatePostData => ({
  v: 2,
  k: 's',
  c: 'n64',
  g: 'Test Game',
  r: 'abcdefgh12345678',
  f: 'ejs-4.2.3:parallel_n64',
  e: 'd',
  m: manifestUrl,
  b: compressedBytes,
  z: 64_000,
  a: 'checksum',
});

const jsonResponse = (value: unknown, status = 200) => {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

describe('State Cartridge client transport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a multi-chunk payload before its manifest', async () => {
    const payload = createPayload(STATE_CARTRIDGE_CHUNK_BYTES + 127);
    const uploadedPayloads: Uint8Array[] = [];
    const progress: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();

        if (url === '/api/state-cartridge/chunk') {
          const parsed = stateCartridgeChunkUploadInputSchema.parse(
            JSON.parse(String(init?.body))
          );
          const chunk = decodeStateCartridgeBase64(parsed.data);
          uploadedPayloads.push(chunk);

          return jsonResponse({
            u: `https://i.redd.it/chunk-${parsed.index}.png`,
            z: chunk.byteLength,
            h: await calculateStateCartridgeSha256(chunk),
          });
        }

        if (url === '/api/state-cartridge/manifest') {
          const manifest = stateCartridgeManifestSchema.parse(
            JSON.parse(String(init?.body))
          );
          const joined = joinStateCartridgePayload(
            uploadedPayloads,
            payload.byteLength
          );

          expect(stateCartridgeBytesEqual(joined, payload)).toBe(true);
          expect(manifest.h).toBe(await calculateStateCartridgeSha256(payload));
          return jsonResponse({
            mediaUrl: 'https://i.redd.it/manifest.png',
          });
        }

        return jsonResponse({ error: 'missing' }, 404);
      })
    );

    await expect(
      uploadStateCartridge(payload, (value) => {
        progress.push(`${value.phase}:${value.completed}/${value.total}`);
      })
    ).resolves.toBe('https://i.redd.it/manifest.png');
    expect(uploadedPayloads).toHaveLength(2);
    expect(progress).toEqual(['upload:0/2', 'upload:1/2', 'manifest:2/2']);
  });

  it('downloads and verifies all chunks before returning the payload', async () => {
    const payloads = [createPayload(4_000), createPayload(2_000)];
    const chunks: StateCartridgeChunkRef[] = [];

    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];

      if (!payload) {
        throw new Error('Missing test payload');
      }

      chunks.push({
        u: `https://i.redd.it/chunk-${index}.png`,
        z: payload.byteLength,
        h: await calculateStateCartridgeSha256(payload),
      });
    }

    const completePayload = joinStateCartridgePayload(payloads, 6_000);
    const manifest: StateCartridgeManifest = {
      v: 1,
      n: completePayload.byteLength,
      h: await calculateStateCartridgeSha256(completePayload),
      chunks,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), 'https://app.local');

        if (url.pathname.endsWith('/manifest')) {
          return jsonResponse(manifest);
        }

        const mediaUrl = url.searchParams.get('url');
        const index = chunks.findIndex((chunk) => chunk.u === mediaUrl);
        const payload = payloads[index];

        if (!payload || index < 0) {
          return jsonResponse({ error: 'missing' }, 404);
        }

        return new Response(Uint8Array.from(payload).buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-EmuArcade-Chunk-Count': chunks.length.toString(),
            'X-EmuArcade-Chunk-Index': index.toString(),
          },
        });
      })
    );

    const downloaded = await downloadStateCartridge(
      createPostData('https://i.redd.it/manifest.png', completePayload.length)
    );
    expect(stateCartridgeBytesEqual(downloaded, completePayload)).toBe(true);
  });

  it('rejects a cartridge when a downloaded chunk was altered', async () => {
    const payload = createPayload(2_000);
    const altered = Uint8Array.from(payload);
    altered[500] = (altered[500] ?? 0) ^ 0xff;
    const reference: StateCartridgeChunkRef = {
      u: 'https://i.redd.it/chunk.png',
      z: payload.byteLength,
      h: await calculateStateCartridgeSha256(payload),
    };
    const manifest: StateCartridgeManifest = {
      v: 1,
      n: payload.byteLength,
      h: await calculateStateCartridgeSha256(payload),
      chunks: [reference],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), 'https://app.local');

        if (url.pathname.endsWith('/manifest')) {
          return jsonResponse(manifest);
        }

        return new Response(Uint8Array.from(altered).buffer, {
          headers: {
            'X-EmuArcade-Chunk-Count': '1',
            'X-EmuArcade-Chunk-Index': '0',
          },
        });
      })
    );

    await expect(
      downloadStateCartridge(
        createPostData('https://i.redd.it/manifest.png', payload.length)
      )
    ).rejects.toThrow('failed verification');
  });
});
