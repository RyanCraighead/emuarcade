import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { Gamepad2, LockKeyhole, Play } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getSystemByCore } from '../shared/emulator';
import type { SharedStatePostData } from '../shared/sharedState';
import { loadSharedPostData } from './sharedPostContext';

export const SharedStatePost = () => {
  const [postData, setPostData] = useState<SharedStatePostData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    void loadSharedPostData().then((value) => {
      if (mounted) {
        setPostData(value);
        setLoaded(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (!loaded) {
    return <div className="shared-state-loading">Loading checkpoint...</div>;
  }

  if (!postData) {
    return (
      <div className="shared-state-loading">
        This checkpoint is unavailable.
      </div>
    );
  }

  const system = getSystemByCore(postData.c)?.shortName ?? postData.c;

  return (
    <button
      aria-label={`Play ${postData.g} from this checkpoint`}
      className="shared-state-post"
      onClick={(event) => requestExpandedMode(event.nativeEvent, 'game')}
    >
      <span className="shared-state-preview">
        {postData.p && !postData.h ? (
          <img
            alt={`${postData.g} checkpoint preview`}
            draggable="false"
            src={postData.p}
          />
        ) : (
          <span className="shared-state-hidden">
            <LockKeyhole aria-hidden="true" />
            <strong>Hidden checkpoint</strong>
            <span>Open it with your matching ROM</span>
          </span>
        )}
        <span className="shared-state-overlay">
          <span className="shared-state-game">
            <Gamepad2 aria-hidden="true" />
            <span>
              <strong>{postData.g}</strong>
              <small>{system} checkpoint</small>
            </span>
          </span>
          <span className="shared-state-play">
            <Play aria-hidden="true" />
            Play from here
          </span>
        </span>
      </span>
    </button>
  );
};

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <StrictMode>
      <SharedStatePost />
    </StrictMode>
  );
}
