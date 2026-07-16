import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPlayStatSystemLabel,
  listPlayStats,
  recordGameLaunch,
} from '../../../src/client/playStats';

const storageKey = 'emuarcade-play-stats:v1';

afterEach(() => {
  vi.useRealTimers();
});

describe('local play statistics', () => {
  it('records launches, updates metadata, and sorts by play count', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    recordGameLaunch({ gameId: 'one', title: 'First', core: 'nes' });

    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    recordGameLaunch({ gameId: 'two', title: 'Second', core: 'gba' });
    recordGameLaunch({ gameId: 'two', title: 'Second Updated', core: 'gb' });

    expect(listPlayStats()).toEqual([
      {
        gameId: 'two',
        title: 'Second Updated',
        core: 'gb',
        playCount: 2,
        lastPlayedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        gameId: 'one',
        title: 'First',
        core: 'nes',
        playCount: 1,
        lastPlayedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('ignores malformed storage and normalizes valid legacy entries', () => {
    window.localStorage.setItem(storageKey, '{not-json');
    expect(listPlayStats()).toEqual([]);

    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          gameId: 'valid',
          title: 'Valid',
          core: 'snes',
          playCount: -3.7,
          lastPlayedAt: '2026-01-01T00:00:00.000Z',
        },
        { gameId: 'bad', title: 'Bad', core: 'invalid' },
      ])
    );

    expect(listPlayStats()).toEqual([
      {
        gameId: 'valid',
        title: 'Valid',
        core: 'snes',
        playCount: 0,
        lastPlayedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('retains only the 24 most relevant games', () => {
    for (let index = 0; index < 30; index += 1) {
      recordGameLaunch({
        gameId: `game-${index}`,
        title: `Game ${index}`,
        core: 'nes',
      });
    }

    expect(listPlayStats()).toHaveLength(24);
  });

  it('formats known system labels', () => {
    expect(getPlayStatSystemLabel('segaMD')).toBe('Genesis');
    expect(getPlayStatSystemLabel('psx')).toBe('PSX');
  });
});
