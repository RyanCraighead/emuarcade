import './index.css';

import {
  CircuitBoard,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Play,
  RadioTower,
} from 'lucide-react';
import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const statusItems = [
  { label: 'Local ROMs', value: 'Ready', icon: HardDrive },
  { label: 'Controls', value: 'Mapped', icon: Gamepad2 },
  { label: 'Core', value: 'Auto', icon: CircuitBoard },
];

export const Splash = () => {
  return (
    <div className="emuarcade-launch-shell bg-[#0b0c0e] text-[#f8f0dc]">
      <button
        className="emuarcade-feed-card group relative grid h-full min-h-0 w-full overflow-hidden rounded-md border border-[#2f3632] bg-[#111416] text-left shadow-[0_16px_44px_rgba(0,0,0,0.34)] transition duration-300 hover:border-[#ff6a24] focus:outline-none focus:ring-2 focus:ring-[#ff6a24]"
        onClick={(event) => requestExpandedMode(event.nativeEvent, 'game')}
      >
        <span className="emuarcade-pixel-field" aria-hidden="true">
          <span className="emuarcade-pixel bg-[#ff8b2c]" />
          <span className="emuarcade-pixel bg-[#34d399]" />
          <span className="emuarcade-pixel bg-[#60a5fa]" />
          <span className="emuarcade-pixel bg-[#fbbf24]" />
          <span className="emuarcade-pixel bg-[#ff8b2c]" />
        </span>

        <span className="emuarcade-launch-layout relative">
          <span className="emuarcade-launch-main">
            <span className="emuarcade-launch-hero flex min-w-0 items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="emuarcade-launch-logo grid shrink-0 place-items-center rounded-md border border-[#37423b] bg-[#181d1b] shadow-inner shadow-white/5">
                  <img
                    className="emuarcade-launch-logo-image"
                    src="/emuarcade-mark.svg"
                    alt=""
                    aria-hidden="true"
                  />
                </span>
                <span className="min-w-0">
                  <span className="emuarcade-launch-title block truncate font-semibold leading-tight">
                    EmuArcade
                  </span>
                  <span className="emuarcade-launch-meta mt-1 flex flex-wrap items-center gap-2 text-xs text-[#c7c0ad]">
                    <span>Player arcade</span>
                    <span className="h-1 w-1 rounded-full bg-[#4d574f]" />
                    <span>Devvit Web</span>
                  </span>
                </span>
              </span>

              <span className="hidden items-center gap-1 rounded bg-[#17211d] px-2 py-1 text-xs font-semibold text-[#63e6a5] sm:inline-flex">
                <span className="emuarcade-live-dot" />
                Ready
              </span>
            </span>

            <span className="emuarcade-launch-body grid gap-3">
              <span className="emuarcade-launch-crt emuarcade-crt relative overflow-hidden rounded-md border border-[#343b37] bg-[#090b0c]">
                <span className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:100%_6px] opacity-40" />
                <span className="emuarcade-scanline" aria-hidden="true" />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#f8f0dc]">
                      Insert local ROM
                    </span>
                    <span className="emuarcade-launch-copy mt-1 block truncate text-xs text-[#aeb7aa]">
                      Title and system are detected on device
                    </span>
                  </span>
                  <FolderOpen className="h-6 w-6 shrink-0 text-[#34d399]" />
                </span>
              </span>

              <span className="emuarcade-launch-status grid grid-cols-3 gap-2">
                {statusItems.map((item) => {
                  const Icon = item.icon;

                  return (
                    <span
                      key={item.label}
                      className="rounded-md border border-[#2b322f] bg-[#171b1a] p-2"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] text-[#9fa99f]">
                        <Icon className="h-3.5 w-3.5 text-[#fbbf24]" />
                        {item.label}
                      </span>
                      <span className="mt-1 block truncate text-xs font-semibold">
                        {item.value}
                      </span>
                    </span>
                  );
                })}
              </span>
            </span>

            <span className="emuarcade-launch-cta flex flex-wrap items-center justify-between gap-3">
              <span className="emuarcade-launch-entry-label inline-flex items-center gap-2 text-xs text-[#c7c0ad]">
                <RadioTower className="h-4 w-4 text-[#60a5fa]" />
                Reddit feed entry
              </span>
              <span className="emuarcade-launch-open emuarcade-open-button inline-flex items-center justify-center gap-2 rounded-md bg-[#ff4500] text-sm font-semibold text-white shadow-[0_8px_24px_rgba(255,69,0,0.28)] transition group-hover:bg-[#ff6424]">
                <Play className="h-4 w-4" />
                Open Arcade
              </span>
            </span>
          </span>

          <span className="emuarcade-launch-cabinet-wrap min-h-0 place-items-center">
            <span className="emuarcade-launch-cabinet emuarcade-mini-cabinet relative block rounded-[18px] border border-[#3d4642] bg-[#15191a] shadow-[0_18px_42px_rgba(0,0,0,0.38)]">
              <span className="absolute left-5 right-5 top-4 h-5 rounded bg-[#ff8b2c] shadow-[0_0_18px_rgba(255,139,44,0.68)]" />
              <span className="absolute left-5 right-5 top-12 h-20 overflow-hidden rounded-md border border-[#323d39] bg-[#071112]">
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(52,211,153,0.42),transparent_42%)]" />
                <span className="emuarcade-screen-sprite left-[42%] top-[38%]" />
                <span className="emuarcade-screen-sprite left-[21%] top-[61%] bg-[#ff8b2c]" />
                <span className="emuarcade-screen-sprite left-[68%] top-[58%] bg-[#60a5fa]" />
              </span>
              <span className="absolute bottom-8 left-6 h-7 w-7 rounded-full border-4 border-[#222827] bg-[#ff4500] shadow-[0_0_16px_rgba(255,69,0,0.55)]" />
              <span className="absolute bottom-9 right-8 grid grid-cols-2 gap-2">
                <span className="h-4 w-4 rounded-full bg-[#fbbf24]" />
                <span className="h-4 w-4 rounded-full bg-[#34d399]" />
                <span className="h-4 w-4 rounded-full bg-[#60a5fa]" />
                <span className="h-4 w-4 rounded-full bg-[#ff8b2c]" />
              </span>
            </span>
          </span>
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
