import { describe, expect, it } from 'vitest';
import { createRomFingerprint } from '../../../src/client/romIdentity';

describe('ROM fingerprints', () => {
  it('is stable for the same ROM and core', async () => {
    const rom = new Blob([Uint8Array.from([1, 2, 3, 4, 5])]);

    await expect(createRomFingerprint(rom, 'nes')).resolves.toBe(
      await createRomFingerprint(rom, 'nes')
    );
  });

  it('changes for different bytes, sizes, and emulator cores', async () => {
    const first = new Blob([Uint8Array.from([1, 2, 3, 4])]);
    const second = new Blob([Uint8Array.from([1, 2, 3, 5])]);
    const base = await createRomFingerprint(first, 'nes');

    expect(await createRomFingerprint(second, 'nes')).not.toBe(base);
    expect(await createRomFingerprint(first, 'snes')).not.toBe(base);
    expect(
      await createRomFingerprint(
        new Blob([first, Uint8Array.of(0)]),
        'nes'
      )
    ).not.toBe(base);
  });
});
