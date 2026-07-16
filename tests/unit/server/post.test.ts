import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitCustomPost = vi.hoisted(() => vi.fn());

vi.mock('@devvit/web/server', () => ({
  reddit: { submitCustomPost },
}));

import { createPost } from '../../../src/server/core/post';

beforeEach(() => {
  submitCustomPost.mockReset();
  submitCustomPost.mockResolvedValue({
    id: 'post',
    permalink: '/post',
    url: '',
  });
});

describe('custom app post creation', () => {
  it('creates the compact chromeless EmuArcade launcher', async () => {
    await createPost();

    expect(submitCustomPost).toHaveBeenCalledWith({
      entry: 'default',
      styles: {
        backgroundColor: '#030405FF',
        backgroundColorDark: '#030405FF',
        heightPixels: 512,
        supportsChromeless: true,
      },
      textFallback: {
        text: 'Open EmuArcade to play games stored on your device.',
      },
      title: 'EmuArcade',
    });
  });
});
