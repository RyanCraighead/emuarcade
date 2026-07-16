import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMULATOR_SYSTEMS } from '../../src/shared/emulator';
import type { EmulatorCore } from '../../src/shared/emulator';

const publicDirectory = path.join(process.cwd(), 'public');
const dataDirectory = path.join(publicDirectory, 'emulatorjs', 'data');
const extractedCoresDirectory = path.join(dataDirectory, 'cores', 'extracted');

const corePackages: Record<EmulatorCore, string> = {
  arcade: 'fbneo-wasm',
  atari2600: 'stella2014-wasm',
  atari7800: 'prosystem-wasm',
  coleco: 'gearcoleco-wasm',
  gb: 'gambatte-wasm',
  gba: 'mgba-wasm',
  lynx: 'handy-wasm',
  n64: 'parallel_n64-wasm',
  nds: 'melonds-wasm',
  nes: 'fceumm-wasm',
  ngp: 'mednafen_ngp-wasm',
  pce: 'mednafen_pce-wasm',
  psp: 'ppsspp-thread-wasm',
  psx: 'pcsx_rearmed-wasm',
  segaGG: 'genesis_plus_gx-wasm',
  segaMD: 'genesis_plus_gx-wasm',
  segaMS: 'smsplus-wasm',
  snes: 'snes9x-wasm',
  vb: 'beetle_vb-wasm',
  ws: 'mednafen_wswan-wasm',
};

const expectNonEmptyFile = async (filePath: string) => {
  const fileStat = await stat(filePath);

  expect(fileStat.isFile()).toBe(true);
  expect(fileStat.size).toBeGreaterThan(0);
};

describe('bundled application assets', () => {
  it('keeps the Devvit entrypoints, media permission, and GPL license intact', async () => {
    const config = JSON.parse(
      await readFile(path.join(process.cwd(), 'devvit.json'), 'utf8')
    );
    const packageManifest = JSON.parse(
      await readFile(path.join(process.cwd(), 'package.json'), 'utf8')
    );

    expect(config.permissions.media).toBe(true);
    expect(config.post.entrypoints.default).toMatchObject({
      entry: 'splash.html',
      inline: true,
    });
    expect(config.post.entrypoints.game.entry).toBe('game.html');
    expect(config.post.entrypoints.shared).toMatchObject({
      entry: 'shared.html',
      inline: true,
    });
    expect(config.permissions.reddit.asUser).toEqual([
      'SUBMIT_POST',
      'SUBMIT_COMMENT',
    ]);
    expect(packageManifest.license).toBe('GPL-3.0-only');
    await expectNonEmptyFile(path.join(process.cwd(), 'LICENSE'));
  });

  it('keeps the emulator runner local and preserves core device features', async () => {
    const runner = await readFile(
      path.join(publicDirectory, 'emulator-runner.js'),
      'utf8'
    );

    expect(runner).toContain("const emulatorDataPath = '/emulatorjs/data/'");
    expect(runner).toContain("script.src = emulatorDataPath + 'loader.js'");
    expect(runner).not.toContain('cdn.emulatorjs.org');
    expect(runner).toContain("n64Core: 'parallel_n64'");
    expect(runner).toContain("const saveArtifactStoreName = 'saveArtifacts'");
    expect(runner).toContain("const touchLayoutStoreName = 'touchLayouts'");
    expect(runner).toContain(
      'window.emuarcadeCaptureStream = getCaptureStream'
    );
    expect(runner).toContain('window.parent.postMessage(');
    expect(runner).toContain("displayName: 'Share State'");
    expect(runner).toContain("data.type === 'emuarcade:load-shared-state'");
  });

  it('ships every responsive launcher asset', async () => {
    const assetNames = [
      'splash-console-phone.webp',
      'splash-console-square.webp',
      'splash-console-regular.webp',
      'splash-console-wide.webp',
      'splash-montage-poster.webp',
      'splash-montage.mp4',
      'emu-mascot.png',
      'emulator-runner.html',
      'emulator-runner.js',
      'emulator-runner.css',
    ];

    await Promise.all(
      assetNames.map((assetName) =>
        expectNonEmptyFile(path.join(publicDirectory, assetName))
      )
    );
  });

  it('ships the local EmulatorJS loader and English localization', async () => {
    await Promise.all(
      ['loader.js', 'emulator.css', 'version.json'].map((assetName) =>
        expectNonEmptyFile(path.join(dataDirectory, assetName))
      )
    );
    await expectNonEmptyFile(
      path.join(dataDirectory, 'localization', 'en-US.json')
    );
  });

  it.each(EMULATOR_SYSTEMS)(
    'ships a loadable $shortName core',
    async (system) => {
      const directory = path.join(
        extractedCoresDirectory,
        corePackages[system.core]
      );
      const files = await readdir(directory);

      expect(files).toContain('manifest.json');
      expect(files.some((fileName) => fileName.endsWith('.js'))).toBe(true);
      expect(files.some((fileName) => fileName.endsWith('.wasm'))).toBe(true);

      const manifest = JSON.parse(
        await readFile(path.join(directory, 'manifest.json'), 'utf8')
      );
      expect(manifest).toBeTruthy();
    }
  );

  it('includes both selectable Nintendo 64 engines', async () => {
    await Promise.all(
      ['parallel_n64-wasm', 'mupen64plus_next-wasm'].map(
        async (directoryName) => {
          const files = await readdir(
            path.join(extractedCoresDirectory, directoryName)
          );

          expect(files.some((fileName) => fileName.endsWith('.wasm'))).toBe(
            true
          );
        }
      )
    );
  });
});
