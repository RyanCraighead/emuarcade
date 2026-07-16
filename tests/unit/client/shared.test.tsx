import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SharedStatePostData } from '../../../src/shared/sharedState';

const clientMocks = vi.hoisted(() => ({
  loadSharedPostData: vi.fn(),
  requestExpandedMode: vi.fn(),
}));

vi.mock('@devvit/web/client', () => ({
  requestExpandedMode: clientMocks.requestExpandedMode,
}));

vi.mock('../../../src/client/sharedPostContext', () => ({
  loadSharedPostData: clientMocks.loadSharedPostData,
}));

import { SharedStatePost } from '../../../src/client/shared';

const postData: SharedStatePostData = {
  v: 1,
  k: 's',
  c: 'nes',
  g: 'Test Adventure',
  r: 'abcdefgh12345678',
  e: 'd',
  s: 'abc',
  z: 10,
  a: 'sum',
  p: 'https://preview.redd.it/checkpoint.gif',
  q: 'g',
};

describe('shared checkpoint inline post', () => {
  it('shows an autoplay-compatible GIF preview and opens the game entry', async () => {
    clientMocks.loadSharedPostData.mockResolvedValue(postData);
    const user = userEvent.setup();

    render(<SharedStatePost />);

    const launch = await screen.findByRole('button', {
      name: 'Play Test Adventure from this checkpoint',
    });
    expect(
      screen.getByRole('img', { name: 'Test Adventure checkpoint preview' })
    ).toHaveAttribute('src', postData.p);

    await user.click(launch);
    expect(clientMocks.requestExpandedMode).toHaveBeenCalledWith(
      expect.any(Event),
      'game'
    );
  });

  it('does not reveal a preview for hidden checkpoints', async () => {
    clientMocks.loadSharedPostData.mockResolvedValue({
      ...postData,
      h: 1,
    });

    render(<SharedStatePost />);

    expect(await screen.findByText('Hidden checkpoint')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
