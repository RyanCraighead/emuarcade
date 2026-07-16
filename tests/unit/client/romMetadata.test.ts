import { describe, expect, it } from 'vitest';
import { detectRomMetadata } from '../../../src/client/romMetadata';
import type { EmulatorCore } from '../../../src/shared/emulator';

type HeaderCase = {
  core: EmulatorCore;
  fileName: string;
  offset: number;
  title: string;
};

const makeRom = (
  fileName: string,
  offset: number,
  title: string,
  minimumSize = 0
) => {
  const encoded = new TextEncoder().encode(title);
  const bytes = new Uint8Array(
    Math.max(offset + encoded.length + 8, minimumSize)
  );

  bytes.set(encoded, offset);
  return new File([bytes], fileName, { type: 'application/octet-stream' });
};

const headerCases: HeaderCase[] = [
  {
    core: 'gb',
    fileName: 'fallback.gb',
    offset: 0x0134,
    title: 'POCKET QUEST',
  },
  {
    core: 'gba',
    fileName: 'fallback.gba',
    offset: 0x00a0,
    title: 'ADVANCE TEST',
  },
  {
    core: 'n64',
    fileName: 'fallback.z64',
    offset: 0x0020,
    title: 'POLY QUEST 64',
  },
  {
    core: 'segaMD',
    fileName: 'fallback.md',
    offset: 0x0150,
    title: 'MEGA TEST',
  },
  {
    core: 'snes',
    fileName: 'fallback.sfc',
    offset: 0x7fc0,
    title: 'SUPER TEST',
  },
];

describe('ROM metadata detection', () => {
  it.each(headerCases)('reads $core title headers', async (testCase) => {
    await expect(
      detectRomMetadata(
        makeRom(testCase.fileName, testCase.offset, testCase.title),
        testCase.core
      )
    ).resolves.toEqual({
      title: testCase.title,
      titleSource: 'header',
    });
  });

  it('falls back through alternate Genesis and SNES header locations', async () => {
    const genesis = makeRom('alternate.md', 0x0120, 'DOMESTIC TITLE', 0x0180);
    const snes = makeRom('alternate.sfc', 0xffc0, 'LOROM ALTERNATE', 0x10000);

    await expect(detectRomMetadata(genesis, 'segaMD')).resolves.toMatchObject({
      title: 'DOMESTIC TITLE',
      titleSource: 'header',
    });
    await expect(detectRomMetadata(snes, 'snes')).resolves.toMatchObject({
      title: 'LOROM ALTERNATE',
      titleSource: 'header',
    });
  });

  it('normalizes non-printable bytes and repeated whitespace', async () => {
    const bytes = new Uint8Array(0x0148);
    bytes.set([84, 69, 83, 84, 0, 32, 32, 71, 65, 77, 69], 0x0134);
    const file = new File([bytes], 'fallback.gb');

    await expect(detectRomMetadata(file, 'gb')).resolves.toEqual({
      title: 'TEST GAME',
      titleSource: 'header',
    });
  });

  it('uses the complete filename when no readable header exists', async () => {
    const file = new File([new Uint8Array(64)], 'My.Game.Release.nes');

    await expect(detectRomMetadata(file, 'nes')).resolves.toEqual({
      title: 'My.Game.Release',
      titleSource: 'filename',
    });
  });
});
