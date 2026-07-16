import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  EMULATOR_SYSTEMS,
  getDefaultClipPostTitle,
  getStateCoreFingerprint,
  getStateN64Core,
  getSystemByCore,
  inferCoreFromFileName,
  isCurrentStateCoreFingerprint,
  isEmulatorCore,
  isN64CoreOption,
  isVideoFilter,
  N64_CORE_OPTIONS,
  VIDEO_FILTERS,
} from '../../../src/shared/emulator';
import type { EmulatorCore } from '../../../src/shared/emulator';

const extensionCases: Array<[string, EmulatorCore]> = [];

for (const system of EMULATOR_SYSTEMS) {
  for (const extension of system.extensions) {
    if (
      !extensionCases.some(([knownExtension]) => knownExtension === extension)
    ) {
      extensionCases.push([extension, system.core]);
    }
  }
}

describe('emulator catalog', () => {
  it('defines every supported core exactly once', () => {
    const cores = EMULATOR_SYSTEMS.map((system) => system.core);

    expect(cores).toHaveLength(20);
    expect(new Set(cores).size).toBe(cores.length);
    expect(
      EMULATOR_SYSTEMS.every((system) => system.extensions.length > 0)
    ).toBe(true);
  });

  it.each(extensionCases)(
    'detects .%s files as %s',
    (extension, expectedCore) => {
      expect(inferCoreFromFileName(`GAME.${extension.toUpperCase()}`)).toBe(
        expectedCore
      );
    }
  );

  it('uses deterministic precedence for shared extensions', () => {
    expect(inferCoreFromFileName('disc.iso')).toBe('psx');
    expect(inferCoreFromFileName('cartridge.bin')).toBe('segaMD');
    expect(inferCoreFromFileName('unknown')).toBe('nes');
  });

  it('looks up and validates public option values', () => {
    expect(getSystemByCore('n64')?.shortName).toBe('N64');
    expect(isEmulatorCore('arcade')).toBe(true);
    expect(isEmulatorCore('dreamcast')).toBe(false);
    expect(VIDEO_FILTERS.every(({ value }) => isVideoFilter(value))).toBe(true);
    expect(isVideoFilter('made-up-filter')).toBe(false);
    expect(N64_CORE_OPTIONS.every(({ value }) => isN64CoreOption(value))).toBe(
      true
    );
    expect(isN64CoreOption('old-core')).toBe(false);
  });

  it('ships performance-safe defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      volume: 0.8,
      muted: false,
      shader: 'disabled',
      n64Core: 'parallel_n64',
      rewind: true,
      threads: false,
      virtualGamepad: true,
      startOnLoad: true,
    });
  });

  it('builds clean default clip post titles from ROM names', () => {
    expect(getDefaultClipPostTitle('Super Mario 64 (USA) [!]')).toBe(
      'Super Mario 64'
    );
    expect(getDefaultClipPostTitle('Metroid Fusion [Rev 1]')).toBe(
      'Metroid Fusion'
    );
    expect(getDefaultClipPostTitle('  Chrono   Trigger  ')).toBe(
      'Chrono Trigger'
    );
  });

  it('fingerprints the exact savestate core implementation', () => {
    expect(getStateCoreFingerprint('nes')).toBe('ejs-4.2.3:fceumm');
    expect(getStateCoreFingerprint('n64', 'parallel_n64')).toBe(
      'ejs-4.2.3:parallel_n64'
    );
    expect(getStateCoreFingerprint('n64', 'mupen64plus_next')).toBe(
      'ejs-4.2.3:mupen64plus_next'
    );
    expect(getStateN64Core('ejs-4.2.3:mupen64plus_next')).toBe(
      'mupen64plus_next'
    );
    expect(getStateN64Core('ejs-4.1.0:mupen64plus_next')).toBeNull();
    expect(isCurrentStateCoreFingerprint('n64', 'ejs-4.2.3:parallel_n64')).toBe(
      true
    );
    expect(isCurrentStateCoreFingerprint('nes', 'ejs-4.1.0:fceumm')).toBe(
      false
    );
  });
});
