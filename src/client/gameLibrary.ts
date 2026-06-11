import {
  DEFAULT_SETTINGS,
  isEmulatorCore,
  isN64CoreOption,
  isVideoFilter,
} from '../shared/emulator';
import type { EmulatorCore, EmulatorSettings } from '../shared/emulator';

const DATABASE_NAME = 'emuarcade-library';
const DATABASE_VERSION = 2;
const STORE_NAME = 'games';
const SAVE_ARTIFACT_STORE_NAME = 'saveArtifacts';
const TOUCH_LAYOUT_STORE_NAME = 'touchLayouts';

export type StoredGame = {
  id: string;
  title: string;
  core: EmulatorCore;
  romName: string;
  romSize: number;
  romType: string | null;
  romBlob: Blob | null;
  biosName: string | null;
  biosBlob: Blob | null;
  settings: EmulatorSettings;
  createdAt: string;
  updatedAt: string;
};

export type CreateGameFromFileInput = {
  id?: string;
  title: string;
  core: EmulatorCore;
  romFile: File;
  biosFile: File | null;
  settings: EmulatorSettings;
  createdAt?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const sanitizeTitle = (title: string, fallback: string) => {
  const trimmed = title.trim();

  return trimmed.length > 0 ? trimmed.slice(0, 120) : fallback;
};

const normalizeSettings = (value: unknown): EmulatorSettings => {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS;
  }

  const volume =
    typeof value.volume === 'number'
      ? Math.min(Math.max(value.volume, 0), 1)
      : DEFAULT_SETTINGS.volume;
  const shader =
    typeof value.shader === 'string' && isVideoFilter(value.shader)
      ? value.shader
      : DEFAULT_SETTINGS.shader;
  const n64Core =
    typeof value.n64Core === 'string' && isN64CoreOption(value.n64Core)
      ? value.n64Core
      : DEFAULT_SETTINGS.n64Core;

  return {
    volume,
    muted:
      typeof value.muted === 'boolean' ? value.muted : DEFAULT_SETTINGS.muted,
    shader,
    n64Core,
    rewind:
      typeof value.rewind === 'boolean'
        ? value.rewind
        : DEFAULT_SETTINGS.rewind,
    threads:
      typeof value.threads === 'boolean'
        ? value.threads
        : DEFAULT_SETTINGS.threads,
    virtualGamepad:
      typeof value.virtualGamepad === 'boolean'
        ? value.virtualGamepad
        : DEFAULT_SETTINGS.virtualGamepad,
    startOnLoad:
      typeof value.startOnLoad === 'boolean'
        ? value.startOnLoad
        : DEFAULT_SETTINGS.startOnLoad,
  };
};

const toStoredGame = (value: unknown): StoredGame | null => {
  if (!isRecord(value)) {
    return null;
  }

  const {
    id,
    title,
    core,
    romName,
    romSize,
    romType,
    romBlob,
    biosName,
    biosBlob,
    settings,
    createdAt,
    updatedAt,
  } = value;

  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    typeof core !== 'string' ||
    !isEmulatorCore(core) ||
    typeof romName !== 'string' ||
    typeof romSize !== 'number' ||
    !(typeof romType === 'string' || romType === null) ||
    !(romBlob instanceof Blob || romBlob === null) ||
    !(typeof biosName === 'string' || biosName === null) ||
    !(biosBlob instanceof Blob || biosBlob === null) ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id,
    title,
    core,
    romName,
    romSize,
    romType,
    romBlob,
    biosName,
    biosBlob,
    settings: normalizeSettings(settings),
    createdAt,
    updatedAt,
  };
};

const openDatabase = async () => {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('core', 'core');
      }

      if (!database.objectStoreNames.contains(SAVE_ARTIFACT_STORE_NAME)) {
        const store = database.createObjectStore(SAVE_ARTIFACT_STORE_NAME, {
          keyPath: 'id',
        });
        store.createIndex('gameId', 'gameId');
        store.createIndex('updatedAt', 'updatedAt');
      }

      if (!database.objectStoreNames.contains(TOUCH_LAYOUT_STORE_NAME)) {
        database.createObjectStore(TOUCH_LAYOUT_STORE_NAME, { keyPath: 'core' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Open failed'));
  });
};

const createId = () => {
  return crypto.randomUUID();
};

const saveGame = async (game: StoredGame) => {
  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.put(game);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Save failed'));
  });

  database.close();
};

export const listGames = async () => {
  const database = await openDatabase();

  const games = await new Promise<StoredGame[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const values: unknown[] = request.result;
      const storedGames = values
        .map((item) => toStoredGame(item))
        .filter((item): item is StoredGame => item !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      resolve(storedGames);
    };
    request.onerror = () => reject(request.error ?? new Error('List failed'));
  });

  database.close();

  return games;
};

export const getGame = async (id: string) => {
  const database = await openDatabase();

  const game = await new Promise<StoredGame | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(toStoredGame(request.result));
    request.onerror = () => reject(request.error ?? new Error('Load failed'));
  });

  database.close();

  return game;
};

export const createGameFromFile = async (input: CreateGameFromFileInput) => {
  const now = new Date().toISOString();
  const game: StoredGame = {
    id: input.id ?? createId(),
    title: sanitizeTitle(input.title, input.romFile.name),
    core: input.core,
    romName: input.romFile.name,
    romSize: input.romFile.size,
    romType: input.romFile.type || null,
    romBlob: input.romFile,
    biosName: input.biosFile?.name ?? null,
    biosBlob: input.biosFile,
    settings: input.settings,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };

  await saveGame(game);

  return game;
};

export const updateGameSettings = async (
  id: string,
  settings: EmulatorSettings
) => {
  const game = await getGame(id);

  if (!game) {
    return null;
  }

  const updatedGame: StoredGame = {
    ...game,
    settings,
    updatedAt: new Date().toISOString(),
  };

  await saveGame(updatedGame);

  return updatedGame;
};

export const deleteGame = async (id: string) => {
  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Delete failed'));
  });

  database.close();
};

export const hasGameFiles = (game: StoredGame) => {
  return game.romBlob instanceof Blob;
};

export const gameMatchesRomFile = (
  game: StoredGame,
  romFile: File,
  core: EmulatorCore
) => {
  return (
    game.core === core &&
    game.romName === romFile.name &&
    game.romSize === romFile.size
  );
};
