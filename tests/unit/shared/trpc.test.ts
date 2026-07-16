import { describe, expect, it, vi } from 'vitest';
import { appRouter, clipShareInputSchema } from '../../../src/shared/trpc';
import type { ClipShareInput } from '../../../src/shared/emulator';
import type { TrpcContext } from '../../../src/shared/trpc';

const validGifInput = (): ClipShareInput => ({
  core: 'gba',
  dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==',
  durationMs: 3_000,
  gameTitle: 'Test Game',
  mimeType: 'image/gif',
  shareFormat: 'gif',
  sizeBytes: 128,
  thumbnailDataUrl: null,
});

describe('clip share validation', () => {
  it('accepts valid GIF and video payloads at supported boundaries', () => {
    expect(clipShareInputSchema.parse(validGifInput())).toMatchObject({
      shareFormat: 'gif',
    });

    expect(
      clipShareInputSchema.parse({
        ...validGifInput(),
        dataUrl: 'data:video/webm;base64,AAAA',
        durationMs: 60_000,
        mimeType: 'video/webm',
        shareFormat: 'video',
        sizeBytes: 20 * 1024 * 1024,
        thumbnailDataUrl: 'data:image/png;base64,AAAA',
      })
    ).toMatchObject({ shareFormat: 'video' });
  });

  it.each([
    [{ ...validGifInput(), dataUrl: 'https://example.com/clip.gif' }],
    [{ ...validGifInput(), mimeType: 'video/webm' }],
    [{ ...validGifInput(), shareFormat: 'video' }],
    [{ ...validGifInput(), sizeBytes: 20 * 1024 * 1024 + 1 }],
    [{ ...validGifInput(), durationMs: 60_001 }],
    [{ ...validGifInput(), thumbnailDataUrl: 'data:text/plain,hello' }],
    [{ ...validGifInput(), core: 'dreamcast' }],
  ])('rejects an invalid clip payload %#', (input) => {
    expect(clipShareInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('app router', () => {
  const createContext = (): TrpcContext => ({
    getAppInfo: vi.fn().mockResolvedValue({
      launchCount: 4,
      postId: 'post-id',
      subredditName: 'emuarcade',
      username: 'player',
    }),
    getViewerState: vi.fn().mockResolvedValue({
      isAuthenticated: true,
      isNewPlayer: false,
    }),
    recordLaunch: vi.fn().mockResolvedValue({ launchCount: 5 }),
    shareClip: vi.fn().mockResolvedValue({
      mediaUrl: 'https://media.example/clip.gif',
      postId: 'post-id',
      postUrl: 'https://reddit.com/r/emuarcade/comments/post-id',
      shareKind: 'gif',
      subredditName: 'emuarcade',
    }),
  });

  it('delegates queries and mutations through the typed context', async () => {
    const context = createContext();
    const caller = appRouter.createCaller(context);

    await expect(caller.appInfo()).resolves.toMatchObject({ launchCount: 4 });
    await expect(caller.viewerState()).resolves.toMatchObject({
      isAuthenticated: true,
    });
    await expect(
      caller.recordLaunch({ core: 'n64', title: 'Super Test 64' })
    ).resolves.toEqual({ launchCount: 5 });
    await expect(caller.shareClip(validGifInput())).resolves.toMatchObject({
      shareKind: 'gif',
    });

    expect(context.recordLaunch).toHaveBeenCalledWith({
      core: 'n64',
      title: 'Super Test 64',
    });
    expect(context.shareClip).toHaveBeenCalledWith(validGifInput());
  });

  it('rejects bad launch data before invoking application code', async () => {
    const context = createContext();
    const caller = appRouter.createCaller(context);

    await expect(
      caller.recordLaunch({ core: 'nes', title: '' })
    ).rejects.toThrow();
    expect(context.recordLaunch).not.toHaveBeenCalled();
  });
});
