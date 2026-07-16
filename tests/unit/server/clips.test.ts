import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipShareInput } from '../../../src/shared/emulator';

type RichTextCall = {
  kind: 'image' | 'text' | 'video';
  value: unknown;
};

const serverMocks = vi.hoisted(() => {
  const mockContext: { subredditName: string | undefined } = {
    subredditName: 'emuarcade',
  };
  const richTextCalls: RichTextCall[] = [];

  return {
    context: mockContext,
    richTextCalls,
    submitPost: vi.fn(),
    upload: vi.fn(),
  };
});

vi.mock('@devvit/web/server', () => {
  class MockRichTextBuilder {
    paragraph(
      callback: (paragraph: { text: (value: unknown) => void }) => void
    ) {
      callback({
        text: (value) =>
          serverMocks.richTextCalls.push({ kind: 'text', value }),
      });
      return this;
    }

    video(value: unknown) {
      serverMocks.richTextCalls.push({ kind: 'video', value });
      return this;
    }

    image(value: unknown) {
      serverMocks.richTextCalls.push({ kind: 'image', value });
      return this;
    }
  }

  return {
    context: serverMocks.context,
    media: { upload: serverMocks.upload },
    reddit: { submitPost: serverMocks.submitPost },
    RichTextBuilder: MockRichTextBuilder,
  };
});

import { shareClip } from '../../../src/server/clips';

const gifInput = (): ClipShareInput => ({
  core: 'n64',
  dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==',
  durationMs: 3_400,
  gameTitle: 'Super Test 64 (USA) [!]',
  mimeType: 'image/gif',
  shareFormat: 'gif',
  sizeBytes: 512,
  thumbnailDataUrl: null,
});

const videoInput = (): ClipShareInput => ({
  ...gifInput(),
  dataUrl: 'data:video/webm;base64,AAAA',
  mimeType: 'video/webm',
  shareFormat: 'video',
  thumbnailDataUrl: 'data:image/png;base64,AAAA',
});

beforeEach(() => {
  serverMocks.context.subredditName = 'emuarcade';
  serverMocks.richTextCalls.length = 0;
  serverMocks.upload.mockReset();
  serverMocks.submitPost.mockReset();
  serverMocks.upload.mockResolvedValue({
    mediaUrl: 'https://media.reddit.test/uploaded',
  });
  serverMocks.submitPost.mockResolvedValue({
    id: 't3_post',
    permalink: '/r/emuarcade/comments/post/clip/',
  });
});

describe('Reddit clip sharing', () => {
  it('uploads GIFs and creates native image posts', async () => {
    await expect(shareClip(gifInput())).resolves.toEqual({
      mediaUrl: 'https://media.reddit.test/uploaded',
      postId: 't3_post',
      postUrl: 'https://www.reddit.com/r/emuarcade/comments/post/clip/',
      shareKind: 'gif',
      subredditName: 'emuarcade',
    });

    expect(serverMocks.upload).toHaveBeenCalledWith({
      type: 'gif',
      url: gifInput().dataUrl,
    });
    expect(serverMocks.submitPost).toHaveBeenCalledWith({
      imageUrls: ['https://media.reddit.test/uploaded'],
      kind: 'image',
      subredditName: 'emuarcade',
      title: 'Super Test 64',
    });
  });

  it('accepts Reddit asynchronous image post creation', async () => {
    serverMocks.submitPost.mockRejectedValue(
      new Error('post is being created asynchronously')
    );

    await expect(shareClip(gifInput())).resolves.toMatchObject({
      postId: null,
      postUrl: null,
      shareKind: 'gif',
    });
  });

  it('does not hide unrelated GIF post failures', async () => {
    serverMocks.submitPost.mockRejectedValue(new Error('permission denied'));

    await expect(shareClip(gifInput())).rejects.toThrow('permission denied');
  });

  it('creates a rich-text video post when video upload succeeds', async () => {
    await expect(shareClip(videoInput())).resolves.toMatchObject({
      shareKind: 'video',
      postId: 't3_post',
    });

    expect(serverMocks.upload).toHaveBeenCalledWith({
      type: 'video',
      url: videoInput().dataUrl,
    });
    expect(serverMocks.richTextCalls.map((call) => call.kind)).toEqual([
      'text',
      'video',
      'text',
    ]);
    expect(serverMocks.submitPost).toHaveBeenCalledWith(
      expect.objectContaining({
        subredditName: 'emuarcade',
        title: 'Super Test 64',
      })
    );
  });

  it('falls back to an image post when video sharing fails', async () => {
    serverMocks.upload
      .mockRejectedValueOnce(new Error('video encoding unavailable'))
      .mockResolvedValueOnce({
        mediaUrl: 'https://media.reddit.test/preview',
      });

    await expect(shareClip(videoInput())).resolves.toMatchObject({
      mediaUrl: 'https://media.reddit.test/preview',
      shareKind: 'image',
    });

    expect(serverMocks.upload).toHaveBeenNthCalledWith(2, {
      type: 'image',
      url: videoInput().thumbnailDataUrl,
    });
    expect(
      serverMocks.richTextCalls.some((call) => call.kind === 'image')
    ).toBe(true);
  });

  it('reports a useful error when video fallback has no thumbnail', async () => {
    serverMocks.upload.mockRejectedValue(new Error('video upload failed'));

    await expect(
      shareClip({ ...videoInput(), thumbnailDataUrl: null })
    ).rejects.toThrow('no preview image was available');
  });

  it('rejects oversized clips before contacting Reddit', async () => {
    await expect(
      shareClip({ ...gifInput(), sizeBytes: 20 * 1024 * 1024 + 1 })
    ).rejects.toThrow('Clip is too large');
    expect(serverMocks.upload).not.toHaveBeenCalled();
  });

  it('requires subreddit context and constrains generated titles', async () => {
    serverMocks.context.subredditName = undefined;
    await expect(shareClip(gifInput())).rejects.toThrow(
      'subredditName is required'
    );

    serverMocks.context.subredditName = 'emuarcade';
    await shareClip({
      ...gifInput(),
      gameTitle: `  ${'Very Long Game '.repeat(20)}  `,
    });
    const submitted = serverMocks.submitPost.mock.calls[0]?.[0];

    expect(submitted?.title.length).toBeLessThanOrEqual(120);
    expect(submitted?.title).not.toContain('  ');
  });

  it('uses a player-supplied title with app-owned uploaded media', async () => {
    await shareClip({
      ...gifInput(),
      postTitle: '  My   best   run  ',
    });

    expect(serverMocks.submitPost).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'My best run',
      })
    );
    expect(serverMocks.submitPost.mock.calls[0]?.[0]).not.toHaveProperty(
      'runAs'
    );
  });
});
