import './index.css';

import {
  Film,
  FolderOpen,
  Hand,
  Play,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  getPlayStatSystemLabel,
  listPlayStats,
} from './playStats';
import type { PlayStat } from './playStats';

type LauncherGame = {
  title: string;
  system: string;
  plays: number;
  accent: string;
};

const fallbackGames: readonly LauncherGame[] = [
  { title: 'Star Runner', system: 'NES', plays: 128, accent: 'orange' },
  { title: 'Puzzle Blocks', system: 'GBA', plays: 96, accent: 'violet' },
  { title: 'Castle Quest', system: 'SNES', plays: 72, accent: 'blue' },
  { title: 'Pocket Rally', system: 'N64', plays: 61, accent: 'red' },
];

const features = [
  { label: 'Local ROMs', detail: 'On device', icon: FolderOpen },
  { label: 'Saves', detail: 'Auto', icon: Save },
  { label: 'Clips', detail: 'Record', icon: Film },
  { label: 'Touch', detail: 'Optimized', icon: Hand },
];

const toLauncherGames = (stats: PlayStat[]): LauncherGame[] => {
  const accents = ['orange', 'violet', 'blue', 'red'];

  return stats.slice(0, 4).map((stat, index) => ({
    title: stat.title,
    system: getPlayStatSystemLabel(stat.core),
    plays: stat.playCount,
    accent: accents[index] ?? 'orange',
  }));
};

const getLauncherGames = () => {
  const stats = listPlayStats();

  return stats.length > 0 ? toLauncherGames(stats) : [...fallbackGames];
};

export const Splash = () => {
  const [games] = useState<LauncherGame[]>(getLauncherGames);

  return (
    <div className="emuarcade-launch-shell bg-[#070809] text-[#f8f4eb]">
      <button
        className="emuarcade-launch-surface group"
        onClick={(event) => requestExpandedMode(event.nativeEvent, 'game')}
      >
        <span className="emuarcade-launch-header">
          <span className="emuarcade-launch-brand">
            <span className="emuarcade-launch-logo" aria-hidden="true">
              <img src="/emuarcade-mark.svg" alt="" />
            </span>
            <span className="emuarcade-launch-title-block">
              <span className="emuarcade-launch-title">EmuArcade</span>
              <span className="emuarcade-launch-subtitle">
                Player arcade <span aria-hidden="true">.</span> Devvit Web
              </span>
            </span>
          </span>

          <span className="emuarcade-launch-ready">
            <span className="emuarcade-launch-ready-dot" />
            Ready
          </span>
        </span>

        <span className="emuarcade-launch-content">
          <span className="emuarcade-launch-context">
            <span className="emuarcade-launch-context-icon" aria-hidden="true">
              <ShieldCheck />
            </span>
            <span>
              <span className="emuarcade-launch-context-title">
                Local emulator
              </span>
              <span className="emuarcade-launch-context-copy">
                Games run on your device.
              </span>
            </span>
          </span>

          <span className="emuarcade-most-played">
            <span className="emuarcade-most-played-head">
              <span>Most played</span>
              <span className="emuarcade-view-all">View all</span>
            </span>

            <span className="emuarcade-game-list">
              {games.map((game) => (
                <span className="emuarcade-game-row" key={game.title}>
                  <span
                    className={`emuarcade-game-mark emuarcade-game-mark--${game.accent}`}
                    aria-hidden="true"
                  >
                    {game.title.slice(0, 1)}
                  </span>
                  <span className="emuarcade-game-title">{game.title}</span>
                  <span className="emuarcade-game-system">{game.system}</span>
                  <span className="emuarcade-game-plays">
                    {game.plays} plays
                  </span>
                </span>
              ))}
            </span>
          </span>

          <span className="emuarcade-launch-action">
            <span className="emuarcade-launch-open">
              <Play />
              Open Arcade
            </span>
            <span className="emuarcade-launch-action-note">
              Browse your local library from Reddit.
            </span>
          </span>
        </span>

        <span className="emuarcade-feature-strip">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <span className="emuarcade-feature" key={feature.label}>
                <Icon />
                <span>
                  <span className="emuarcade-feature-label">
                    {feature.label}
                  </span>
                  <span className="emuarcade-feature-detail">
                    {feature.detail}
                  </span>
                </span>
              </span>
            );
          })}
        </span>
      </button>
    </div>
  );
};

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <StrictMode>
      <Splash />
    </StrictMode>
  );
}
