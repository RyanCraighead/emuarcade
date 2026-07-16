import { describe, expect, it } from 'vitest';
import {
  MAX_SHARED_POST_DATA_BYTES,
  decodeSharedState,
  encodeSharedState,
  measurePostDataBytes,
  parseSharedStatePostData,
  withSharedStatePreview,
} from '../../../src/shared/sharedState';

const metadata = {
  core: 'n64' as const,
  gameTitle: 'Test Kart 64',
  romFingerprint: 'abc12345def67890',
};

describe('shared save-state codec', () => {
  it.each([
    ['zero-filled', new Uint8Array(32_768)],
    [
      'page-repeating',
      Uint8Array.from({ length: 32_768 }, (_, index) => index % 256),
    ],
    [
      'changing',
      Uint8Array.from(
        { length: 4_096 },
        (_, index) => (index * 37 + Math.floor(index / 17)) & 0xff
      ),
    ],
  ])('round trips %s states without changing a byte', (_name, state) => {
    const encoded = encodeSharedState(state, metadata);

    expect(decodeSharedState(encoded.postData)).toEqual(state);
    expect(encoded.rawBytes).toBe(state.byteLength);
    expect(encoded.compressedBytes).toBeGreaterThan(0);
    expect(encoded.postDataBytes).toBe(
      measurePostDataBytes(encoded.postData)
    );
  });

  it('reports whether the complete JSON payload fits the safe post limit', () => {
    const compact = encodeSharedState(new Uint8Array(64_000), metadata);
    const random = new Uint8Array(8_000);
    let seed = 0x12345678;

    for (let index = 0; index < random.length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      random[index] = (seed >>> 24) & 0xff;
    }

    const oversized = encodeSharedState(random, metadata);

    expect(compact.fits).toBe(true);
    expect(compact.postDataBytes).toBeLessThanOrEqual(
      MAX_SHARED_POST_DATA_BYTES
    );
    expect(oversized.fits).toBe(false);
    expect(oversized.postDataBytes).toBeGreaterThan(
      MAX_SHARED_POST_DATA_BYTES
    );
  });

  it('accounts for preview URLs and hidden-preview metadata', () => {
    const encoded = encodeSharedState(new Uint8Array(16_000), metadata);
    const imagePost = withSharedStatePreview(
      encoded.postData,
      'https://preview.redd.it/checkpoint.gif',
      'gif'
    );
    const hiddenPost = withSharedStatePreview(
      encoded.postData,
      null,
      'hidden'
    );

    expect(imagePost).toMatchObject({
      p: 'https://preview.redd.it/checkpoint.gif',
      q: 'g',
    });
    expect(hiddenPost).toMatchObject({ h: 1 });
    expect(measurePostDataBytes(imagePost)).toBeGreaterThan(
      encoded.postDataBytes
    );
  });

  it('rejects corrupted and malformed shared states', () => {
    const encoded = encodeSharedState(new Uint8Array(4_096), metadata);
    const corrupted = { ...encoded.postData, a: 'wrong' };
    const wrongLength = { ...encoded.postData, z: encoded.postData.z + 1 };

    expect(() => decodeSharedState(corrupted)).toThrow('integrity');
    expect(() => decodeSharedState(wrongLength)).toThrow('invalid length');
    expect(() => encodeSharedState(new Uint8Array(), metadata)).toThrow(
      'empty'
    );
    expect(parseSharedStatePostData({ nope: true })).toBeNull();
    expect(parseSharedStatePostData(encoded.postData)).toEqual(
      encoded.postData
    );
  });

  it('uses hidden metadata whenever a requested preview has no media URL', () => {
    const encoded = encodeSharedState(new Uint8Array(1_024), metadata);

    expect(
      withSharedStatePreview(encoded.postData, null, 'image')
    ).toMatchObject({ h: 1 });
  });
});
