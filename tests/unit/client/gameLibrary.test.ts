import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGameFromFile,
  deleteGame,
  gameMatchesRomFile,
  getGame,
  hasGameFiles,
  listGames,
  updateGameSettings,
} from '../../../src/client/gameLibrary';
import type { StoredGame } from '../../../src/client/gameLibrary';
import { DEFAULT_SETTINGS } from '../../../src/shared/emulator';

const databaseName = 'emuarcade-library';

const deleteDatabase = async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Delete failed'));
    request.onblocked = () =>
      reject(new Error('Database deletion was blocked'));
  });
};

const makeRom = (name = 'test.gba', contents = 'rom') => {
  return new File([contents], name, { type: 'application/octet-stream' });
};

beforeEach(async () => {
  vi.useRealTimers();
  await deleteDatabase();
});

describe('IndexedDB game library', () => {
  it('creates and retrieves local ROM and BIOS records', async () => {
    const romFile = makeRom();
    const biosFile = new File(['bios'], 'gba_bios.bin');
    const created = await createGameFromFile({
      id: 'game-1',
      title: '  Test Advance  ',
      core: 'gba',
      romFile,
      biosFile,
      settings: DEFAULT_SETTINGS,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(created).toMatchObject({
      id: 'game-1',
      title: 'Test Advance',
      core: 'gba',
      romName: 'test.gba',
      biosName: 'gba_bios.bin',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const loaded = await getGame('game-1');
    expect(loaded).not.toBeNull();
    expect(loaded && hasGameFiles(loaded)).toBe(true);
    expect(loaded?.romSize).toBe(romFile.size);
  });

  it('uses a filename fallback and limits custom titles', async () => {
    const fallback = await createGameFromFile({
      id: 'fallback',
      title: '   ',
      core: 'nes',
      romFile: makeRom('fallback.nes'),
      biosFile: null,
      settings: DEFAULT_SETTINGS,
    });
    const longTitle = await createGameFromFile({
      id: 'long',
      title: 'x'.repeat(150),
      core: 'nes',
      romFile: makeRom('long.nes'),
      biosFile: null,
      settings: DEFAULT_SETTINGS,
    });

    expect(fallback.title).toBe('fallback.nes');
    expect(longTitle.title).toHaveLength(120);
  });

  it('updates settings and deletes games without affecting other entries', async () => {
    await createGameFromFile({
      id: 'one',
      title: 'One',
      core: 'n64',
      romFile: makeRom('one.z64'),
      biosFile: null,
      settings: DEFAULT_SETTINGS,
    });
    await createGameFromFile({
      id: 'two',
      title: 'Two',
      core: 'nes',
      romFile: makeRom('two.nes'),
      biosFile: null,
      settings: DEFAULT_SETTINGS,
    });

    const updated = await updateGameSettings('one', {
      ...DEFAULT_SETTINGS,
      n64Core: 'mupen64plus_next',
      volume: 0.25,
    });

    expect(updated?.settings).toMatchObject({
      n64Core: 'mupen64plus_next',
      volume: 0.25,
    });
    expect(await updateGameSettings('missing', DEFAULT_SETTINGS)).toBeNull();

    await deleteGame('one');
    expect(await getGame('one')).toBeNull();
    expect((await listGames()).map((game) => game.id)).toEqual(['two']);
  });

  it('sorts by update time and matches a game to its original local file', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const firstRom = makeRom('first.nes', 'first');
    const first = await createGameFromFile({
      id: 'first',
      title: 'First',
      core: 'nes',
      romFile: firstRom,
      biosFile: null,
      settings: DEFAULT_SETTINGS,
    });

    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    await createGameFromFile({
      id: 'second',
      title: 'Second',
      core: 'snes',
      romFile: makeRom('second.sfc'),
      biosFile: null,
      settings: DEFAULT_SETTINGS,
    });

    expect((await listGames()).map((game) => game.id)).toEqual([
      'second',
      'first',
    ]);
    expect(gameMatchesRomFile(first, firstRom, 'nes')).toBe(true);
    expect(
      gameMatchesRomFile(first, makeRom('first.nes', 'other'), 'nes')
    ).toBe(true);
    expect(gameMatchesRomFile(first, firstRom, 'snes')).toBe(false);
  });

  it('normalizes settings from older database records', async () => {
    await listGames();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Open failed'));
    });
    const rawGame: StoredGame = {
      id: 'legacy',
      title: 'Legacy',
      core: 'nes',
      romName: 'legacy.nes',
      romSize: 3,
      romType: null,
      romBlob: new Blob(['rom']),
      biosName: null,
      biosBlob: null,
      settings: {
        ...DEFAULT_SETTINGS,
        volume: 4,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('games', 'readwrite');
      transaction.objectStore('games').put(rawGame);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Write failed'));
    });
    database.close();

    expect((await getGame('legacy'))?.settings.volume).toBe(1);
  });
});
