import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateStateCartridgeSha256,
  encodeStateCartridgeBase64,
  joinStateCartridgePayload,
} from '../../../src/shared/stateCartridge';

const serverMocks = vi.hoisted(() => ({
  upload: vi.fn(),
}));

vi.mock('@devvit/web/server', () => ({
  media: { upload: serverMocks.upload },
}));

import {
  assertRedditMediaUrl,
  readStateCartridgeChunk,
  readStateCartridgeManifest,
  uploadStateCartridgeChunk,
  uploadStateCartridgeManifest,
} from '../../../src/server/stateCartridges';

const mediaStore = new Map<string, Uint8Array>();
let mediaId = 0;

const decodeDataUrl = (dataUrl: string) => {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const createPayload = (length: number, seed: number) => {
  return Uint8Array.from(
    { length },
    (_, index) => (index * 31 + seed * 17) & 0xff
  );
};

beforeEach(() => {
  mediaId = 0;
  mediaStore.clear();
  serverMocks.upload.mockReset();
  serverMocks.upload.mockImplementation(
    async ({ url }: { type: string; url: string }) => {
      mediaId += 1;
      const mediaUrl = `https://i.redd.it/state-cartridge-${mediaId}.png`;
      mediaStore.set(mediaUrl, decodeDataUrl(url));
      return { mediaId: `media-${mediaId}`, mediaUrl };
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const value = url.toString();
      const bytes = mediaStore.get(value);

      if (!bytes) {
        return new Response('missing', { status: 404 });
      }

      return new Response(Uint8Array.from(bytes).buffer, {
        status: 200,
        headers: {
          'content-length': bytes.byteLength.toString(),
          'content-type': 'image/png',
        },
      });
    })
  );
});

describe('Reddit State Cartridge storage', () => {
  it('uploads and byte-verifies a state chunk', async () => {
    const payload = createPayload(48_000, 3);
    const result = await uploadStateCartridgeChunk({
      data: encodeStateCartridgeBase64(payload),
      index: 0,
      count: 1,
    });
    const decoded = await readStateCartridgeChunk(result.u);

    expect(result).toEqual({
      u: 'https://i.redd.it/state-cartridge-1.png',
      z: payload.byteLength,
      h: await calculateStateCartridgeSha256(payload),
    });
    expect(decoded.payload).toEqual(payload);
    expect(serverMocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image' })
    );
  });

  it('uploads a manifest only after verifying every referenced chunk', async () => {
    const payloads = [createPayload(1_100, 1), createPayload(900, 2)];
    const chunks = [];

    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];

      if (!payload) {
        throw new Error('Missing test payload');
      }

      chunks.push(
        await uploadStateCartridgeChunk({
          data: encodeStateCartridgeBase64(payload),
          index,
          count: payloads.length,
        })
      );
    }

    const completePayload = joinStateCartridgePayload(payloads, 2_000);
    const manifest = {
      v: 1 as const,
      n: completePayload.byteLength,
      h: await calculateStateCartridgeSha256(completePayload),
      chunks,
    };
    const result = await uploadStateCartridgeManifest(manifest);

    expect(result.mediaUrl).toBe('https://i.redd.it/state-cartridge-3.png');
    await expect(readStateCartridgeManifest(result.mediaUrl)).resolves.toEqual(
      manifest
    );
  });

  it('rejects altered Reddit round trips and non-Reddit media URLs', async () => {
    serverMocks.upload.mockImplementationOnce(
      async ({ url }: { type: string; url: string }) => {
        const mediaUrl = 'https://i.redd.it/altered.png';
        const altered = decodeDataUrl(url);
        const index = Math.floor(altered.length / 2);
        altered[index] = (altered[index] ?? 0) ^ 0xff;
        mediaStore.set(mediaUrl, altered);
        return { mediaId: 'altered', mediaUrl };
      }
    );

    await expect(
      uploadStateCartridgeChunk({
        data: encodeStateCartridgeBase64(createPayload(1_024, 4)),
        index: 0,
        count: 1,
      })
    ).rejects.toThrow();
    expect(() => assertRedditMediaUrl('https://example.com/state.png')).toThrow(
      'Reddit-hosted'
    );
    expect(() =>
      assertRedditMediaUrl('https://i.redd.it.example.com/state.png')
    ).toThrow('Reddit-hosted');
    expect(() => assertRedditMediaUrl('http://i.redd.it/state.png')).toThrow(
      'Reddit-hosted'
    );
    expect(assertRedditMediaUrl('https://preview.redd.it/state.png')).toBe(
      'https://preview.redd.it/state.png'
    );
  });
});
