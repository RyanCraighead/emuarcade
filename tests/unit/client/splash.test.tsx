import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const requestExpandedMode = vi.hoisted(() => vi.fn());

vi.mock('@devvit/web/client', () => ({
  requestExpandedMode,
}));

import { Splash } from '../../../src/client/splash';

describe('splash launcher', () => {
  it('provides responsive artwork, a local montage, and one launch action', async () => {
    const user = userEvent.setup();
    const { container } = render(<Splash />);
    const launchButton = screen.getByRole('button', { name: 'Open EmuArcade' });

    expect(container.querySelectorAll('picture source')).toHaveLength(3);
    expect(container.querySelector('picture img')).toHaveAttribute(
      'src',
      '/splash-console-square.webp'
    );
    expect(container.querySelector('video source')).toHaveAttribute(
      'src',
      '/splash-montage.mp4'
    );
    expect(container.querySelector('video')).toHaveAttribute(
      'poster',
      '/splash-montage-poster.webp'
    );

    await user.click(launchButton);

    expect(requestExpandedMode).toHaveBeenCalledOnce();
    expect(requestExpandedMode).toHaveBeenCalledWith(expect.any(Event), 'game');
  });
});
