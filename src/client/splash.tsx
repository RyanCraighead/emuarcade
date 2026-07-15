import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const tickerItems = [
  'NES',
  'SNES',
  'GB',
  'GBA',
  'Genesis',
  'N64',
  'NDS',
  'PSX',
  'PSP',
  'Arcade',
  'Gamepad',
  'Touch',
  'Local saves',
  'Clips',
] as const;

const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

export const Splash = () => {
  return (
    <div className="console-splash-shell">
      <button
        aria-label="Open EmuArcade"
        className="console-splash"
        onClick={(event) => requestExpandedMode(event.nativeEvent, 'game')}
      >
        <span className="console-splash-header" aria-hidden="true">
          <span className="console-splash-brand">
            <img src="/emu-mascot.png" alt="" />
            <span>EmuArcade</span>
          </span>
          <span className="console-splash-header-vents">
            <i />
            <i />
            <i />
          </span>
        </span>

        <span className="console-splash-left" aria-hidden="true">
          <span className="console-splash-speaker">
            <i />
            <i />
            <i />
            <i />
          </span>

          <span className="console-splash-dpad">
            <i className="console-splash-dpad-vertical" />
            <i className="console-splash-dpad-horizontal" />
            <i className="console-splash-dpad-center" />
          </span>

          <span className="console-splash-control-label">Move</span>
        </span>

        <span className="console-splash-screen" aria-hidden="true">
          <span className="console-splash-screen-grid" aria-hidden="true" />
          <span className="console-splash-scanline" aria-hidden="true" />
          <video
            className="console-splash-video"
            autoPlay={!prefersReducedMotion}
            disablePictureInPicture
            disableRemotePlayback
            loop
            muted
            playsInline
            poster="/splash-montage-poster.webp"
            preload="auto"
          >
            <source src="/splash-montage.mp4" type="video/mp4" />
          </video>

          <span className="console-splash-ticker">
            <span className="console-splash-ticker-track">
              {[0, 1].map((copy) => (
                <span className="console-splash-ticker-group" key={copy}>
                  {tickerItems.map((item) => (
                    <span key={`${copy}-${item}`}>{item}</span>
                  ))}
                </span>
              ))}
            </span>
          </span>
        </span>

        <span className="console-splash-right" aria-hidden="true">
          <span className="console-splash-buttons">
            <i className="console-splash-button console-splash-button--y">Y</i>
            <i className="console-splash-button console-splash-button--x">X</i>
            <i className="console-splash-button console-splash-button--b">B</i>
            <i className="console-splash-button console-splash-button--a">A</i>
          </span>

          <span className="console-splash-menu-buttons">
            <span>
              <i />
              Select
            </span>
            <span>
              <i />
              Start
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
