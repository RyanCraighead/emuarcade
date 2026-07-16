import { describe, expect, it } from 'vitest';
import {
  MAX_STATE_CARTRIDGE_PNG_BYTES,
  STATE_CARTRIDGE_CHUNK_BYTES,
  calculateStateCartridgeSha256,
  decodeStateCartridgeManifest,
  decodeStateCartridgePng,
  encodeStateCartridgeManifest,
  encodeStateCartridgePng,
  joinStateCartridgePayload,
  splitStateCartridgePayload,
  stateCartridgeBytesEqual,
} from '../../../src/shared/stateCartridge';

const createBytes = (length: number) => {
  const bytes = new Uint8Array(length);
  let state = 0x9e3779b9;

  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }

  return bytes;
};

describe('State Cartridge PNG codec', () => {
  it.each([1, 73, 32_768, 250_000])(
    'round trips %i payload bytes exactly',
    (length) => {
      const payload = createBytes(length);
      const png = encodeStateCartridgePng(payload, {
        kind: 'chunk',
        index: 1,
        count: 3,
      });
      const decoded = decodeStateCartridgePng(png);

      expect(decoded).toMatchObject({
        kind: 'chunk',
        index: 1,
        count: 3,
      });
      expect(decoded.payload).toEqual(payload);
      expect(stateCartridgeBytesEqual(decoded.payload, payload)).toBe(true);
    }
  );

  it('splits and joins multi-image payloads without changing a byte', () => {
    const payload = createBytes(STATE_CARTRIDGE_CHUNK_BYTES + 317);
    const chunks = splitStateCartridgePayload(payload);
    const joined = joinStateCartridgePayload(chunks, payload.byteLength);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(STATE_CARTRIDGE_CHUNK_BYTES);
    expect(stateCartridgeBytesEqual(joined, payload)).toBe(true);
  });

  it('keeps a maximum-size chunk within the PNG transport limit', () => {
    const payload = createBytes(STATE_CARTRIDGE_CHUNK_BYTES);
    const png = encodeStateCartridgePng(payload, {
      kind: 'chunk',
      index: 0,
      count: 1,
    });

    expect(png.byteLength).toBeLessThanOrEqual(MAX_STATE_CARTRIDGE_PNG_BYTES);
    expect(
      stateCartridgeBytesEqual(decodeStateCartridgePng(png).payload, payload)
    ).toBe(true);
  });

  it('round trips and validates manifests', async () => {
    const first = createBytes(800);
    const second = createBytes(400);
    const payload = joinStateCartridgePayload(
      [first, second],
      first.byteLength + second.byteLength
    );
    const manifest = {
      v: 1 as const,
      n: payload.byteLength,
      h: await calculateStateCartridgeSha256(payload),
      chunks: [
        {
          u: 'https://i.redd.it/chunk-one.png',
          z: first.byteLength,
          h: await calculateStateCartridgeSha256(first),
        },
        {
          u: 'https://i.redd.it/chunk-two.png',
          z: second.byteLength,
          h: await calculateStateCartridgeSha256(second),
        },
      ],
    };

    expect(
      decodeStateCartridgeManifest(encodeStateCartridgeManifest(manifest))
    ).toEqual(manifest);
  });

  it('rejects corrupted images, payload metadata, and manifests', async () => {
    const payload = createBytes(1_024);
    const png = encodeStateCartridgePng(payload, { kind: 'manifest' });
    const corrupted = Uint8Array.from(png);
    const corruptedIndex = Math.floor(corrupted.length / 2);
    const payloadHash = await calculateStateCartridgeSha256(payload);

    corrupted[corruptedIndex] = (corrupted[corruptedIndex] ?? 0) ^ 0xff;

    expect(() => decodeStateCartridgePng(corrupted)).toThrow('integrity');
    expect(() =>
      encodeStateCartridgePng(new Uint8Array(), { kind: 'chunk' })
    ).toThrow('empty');
    expect(() =>
      decodeStateCartridgeManifest(
        new TextEncoder().encode(
          JSON.stringify({
            v: 1,
            n: 2,
            h: payloadHash,
            chunks: [
              {
                u: 'https://i.redd.it/chunk.png',
                z: 1,
                h: payloadHash,
              },
            ],
          })
        )
      )
    ).toThrow('chunk lengths');
  });
});
