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
        <span className="console-splash-device" aria-hidden="true">
          <picture className="console-splash-art">
            <source
              media="(max-aspect-ratio: 3/4)"
              srcSet="/splash-console-phone.webp"
            />
            <source
              media="(min-aspect-ratio: 8/5)"
              srcSet="/splash-console-wide.webp"
            />
            <source
              media="(min-aspect-ratio: 23/20)"
              srcSet="/splash-console-regular.webp"
            />
            <img
              alt=""
              draggable="false"
              src="/splash-console-square.webp"
            />
          </picture>

          <span className="console-splash-screen">
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
            <span className="console-splash-screen-grid" />
            <span className="console-splash-scanline" />
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
