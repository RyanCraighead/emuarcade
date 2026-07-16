import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  context: { subredditName: 'emuarcade' },
  createPost: vi.fn(),
}));

vi.mock('@devvit/web/server', () => ({
  context: routeMocks.context,
}));

vi.mock('../../../src/server/core/post', () => ({
  createPost: routeMocks.createPost,
}));

import { menu } from '../../../src/server/routes/menu';
import { triggers } from '../../../src/server/routes/triggers';

beforeEach(() => {
  routeMocks.createPost.mockReset();
  routeMocks.createPost.mockResolvedValue({
    id: 't3_created',
    permalink: '/r/emuarcade/comments/created',
    url: 'https://reddit.test/post',
  });
});

describe('Devvit HTTP routes', () => {
  it('returns navigation after a menu-created post', async () => {
    const response = await menu.request('/post-create', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      navigateTo: {
        permalink: '/r/emuarcade/comments/created',
        url: 'https://reddit.test/post',
      },
    });
  });

  it('returns a toast when menu post creation fails', async () => {
    routeMocks.createPost.mockRejectedValue(new Error('Reddit unavailable'));
    const response = await menu.request('/post-create', { method: 'POST' });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      showToast: 'Failed to create post',
    });
  });

  it('creates the install post and names the trigger context', async () => {
    const response = await triggers.request('/on-app-install', {
      body: JSON.stringify({ type: 'onAppInstall' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'success',
      message:
        'Post created in subreddit emuarcade with id t3_created (trigger: onAppInstall)',
    });
  });

  it('reports trigger failures without leaking internals', async () => {
    routeMocks.createPost.mockRejectedValue(new Error('private detail'));
    const response = await triggers.request('/on-app-install', {
      body: JSON.stringify({ type: 'onAppInstall' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: 'error',
      message: 'Failed to create post',
    });
  });
});
