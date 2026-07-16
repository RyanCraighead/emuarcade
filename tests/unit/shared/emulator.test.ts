import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  EMULATOR_SYSTEMS,
  getSystemByCore,
  inferCoreFromFileName,
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
});
