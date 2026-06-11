import { getSystemByCore, isEmulatorCore } from '../shared/emulator';
import type { EmulatorCore } from '../shared/emulator';

const PLAY_STATS_STORAGE_KEY = 'emuarcade-play-stats:v1';

export type PlayStat = {
  gameId: string;
  title: string;
  core: EmulatorCore;
  playCount: number;
  lastPlayedAt: string;
};

export type RecordGameLaunchInput = {
  gameId: string;
  title: string;
  core: EmulatorCore;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const normalizePlayStat = (value: unknown): PlayStat | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { gameId, title, core, playCount, lastPlayedAt } = value;

  if (
    typeof gameId !== 'string' ||
    typeof title !== 'string' ||
    typeof core !== 'string' ||
    !isEmulatorCore(core) ||
    typeof playCount !== 'number' ||
    typeof lastPlayedAt !== 'string'
  ) {
    return null;
  }

  return {
    gameId,
    title,
    core,
    playCount: Math.max(0, Math.floor(playCount)),
    lastPlayedAt,
  };
};

const sortPlayStats = (stats: PlayStat[]) => {
  return [...stats].sort((left, right) => {
    if (right.playCount !== left.playCount) {
      return right.playCount - left.playCount;
    }

    return right.lastPlayedAt.localeCompare(left.lastPlayedAt);
  });
};

const readPlayStats = () => {
  try {
    const payload = window.localStorage.getItem(PLAY_STATS_STORAGE_KEY);

    if (!payload) {
      return [];
    }

    const parsed: unknown = JSON.parse(payload);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizePlayStat(item))
      .filter((item): item is PlayStat => item !== null);
  } catch {
    return [];
  }
};

const writePlayStats = (stats: PlayStat[]) => {
  try {
    window.localStorage.setItem(
      PLAY_STATS_STORAGE_KEY,
      JSON.stringify(sortPlayStats(stats).slice(0, 24))
    );
  } catch {
    // Best-effort local preference data; launching should never depend on it.
  }
};

export const listPlayStats = () => {
  return sortPlayStats(readPlayStats());
};

export const recordGameLaunch = (input: RecordGameLaunchInput) => {
  const stats = readPlayStats();
  const now = new Date().toISOString();
  const existing = stats.find((stat) => stat.gameId === input.gameId);

  if (existing) {
    writePlayStats(
      stats.map((stat) =>
        stat.gameId === input.gameId
          ? {
              ...stat,
              core: input.core,
              lastPlayedAt: now,
              playCount: stat.playCount + 1,
              title: input.title,
            }
          : stat
      )
    );
    return;
  }

  writePlayStats([
    ...stats,
    {
      core: input.core,
      gameId: input.gameId,
      lastPlayedAt: now,
      playCount: 1,
      title: input.title,
    },
  ]);
};

export const getPlayStatSystemLabel = (core: EmulatorCore) => {
  return getSystemByCore(core)?.shortName ?? core.toUpperCase();
};
