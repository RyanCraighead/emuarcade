import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSharedState } from '../../../src/shared/sharedState';
import type { SharedStateShareInput } from '../../../src/shared/sharedState';

const serverMocks = vi.hoisted(() => ({
  context: { subredditName: 'emuarcade' as string | undefined },
  submitComment: vi.fn(),
  submitCustomPost: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@devvit/web/server', () => ({
  context: serverMocks.context,
  media: { upload: serverMocks.upload },
  reddit: {
    submitComment: serverMocks.submitComment,
    submitCustomPost: serverMocks.submitCustomPost,
  },
}));

import { shareState, shareStateComment } from '../../../src/server/shares';

const createInput = (
  previewKind: SharedStateShareInput['previewKind'] = 'image'
): SharedStateShareInput => ({
  postData: encodeSharedState(new Uint8Array(24_000), {
    core: 'nes',
    gameTitle: 'Test Adventure',
    romFingerprint: 'abcdefgh12345678',
  }).postData,
  previewDataUrl:
    previewKind === 'hidden' ? null : 'data:image/png;base64,AAAA',
  previewKind,
  title: '  My   checkpoint  ',
});

beforeEach(() => {
  serverMocks.context.subredditName = 'emuarcade';
  serverMocks.upload.mockReset();
  serverMocks.submitComment.mockReset();
  serverMocks.submitCustomPost.mockReset();
  serverMocks.upload.mockResolvedValue({
    mediaUrl: 'https://preview.redd.it/checkpoint.png',
  });
  serverMocks.submitCustomPost.mockResolvedValue({
    id: 't3_checkpoint',
    permalink: '/r/emuarcade/comments/checkpoint/play_from_here/',
  });
  serverMocks.submitComment.mockResolvedValue({ id: 't1_comment' });
});

describe('shared checkpoint posts', () => {
  it('uploads a preview and submits a user-authored custom app post', async () => {
    const result = await shareState(createInput());

    expect(serverMocks.upload).toHaveBeenCalledWith({
      type: 'image',
      url: 'data:image/png;base64,AAAA',
    });
    expect(serverMocks.submitCustomPost).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: 'shared',
        runAs: 'USER',
        subredditName: 'emuarcade',
        title: 'My checkpoint',
        userGeneratedContent: expect.objectContaining({
          imageUrls: ['https://preview.redd.it/checkpoint.png'],
        }),
      })
    );
    expect(result).toMatchObject({
      mediaUrl: 'https://preview.redd.it/checkpoint.png',
      postId: 't3_checkpoint',
      subredditName: 'emuarcade',
    });
  });

  it('creates hidden spoiler checkpoints without uploading media', async () => {
    await shareState(createInput('hidden'));

    expect(serverMocks.upload).not.toHaveBeenCalled();
    expect(serverMocks.submitCustomPost).toHaveBeenCalledWith(
      expect.objectContaining({
        spoiler: true,
        userGeneratedContent: {
          text: 'Shared a hidden EmuArcade checkpoint for Test Adventure.',
        },
      })
    );
  });

  it('posts an explicitly requested user comment', async () => {
    await expect(
      shareStateComment({ postId: 't3_checkpoint', text: 'Try the left path.' })
    ).resolves.toEqual({ commentId: 't1_comment' });
    expect(serverMocks.submitComment).toHaveBeenCalledWith({
      id: 't3_checkpoint',
      runAs: 'USER',
      text: 'Try the left path.',
    });
  });

  it('rejects invalid context, invalid IDs, and oversized post data', async () => {
    serverMocks.context.subredditName = undefined;
    await expect(shareState(createInput())).rejects.toThrow('subredditName');

    await expect(
      shareStateComment({ postId: 'bad', text: 'Nope' })
    ).rejects.toThrow('Invalid post ID');

    serverMocks.context.subredditName = 'emuarcade';
    const oversized = createInput('hidden');
    oversized.postData = {
      ...oversized.postData,
      s: 'x'.repeat(2_000),
    };
    await expect(shareState(oversized)).rejects.toThrow('post-data limit');
  });

  it('validates previews before calling Reddit media upload', async () => {
    await expect(
      shareState({ ...createInput(), previewDataUrl: null })
    ).rejects.toThrow('preview is required');
    await expect(
      shareState({ ...createInput(), previewDataUrl: 'not-a-data-url' })
    ).rejects.toThrow('Invalid preview data URL');
    expect(serverMocks.upload).not.toHaveBeenCalled();

    await expect(
      shareState({
        ...createInput(),
        previewDataUrl: 'data:image/png,plain%20preview',
      })
    ).resolves.toMatchObject({ postId: 't3_checkpoint' });
  });

  it('rejects corrupt state data before uploading its preview', async () => {
    const input = createInput();

    await expect(
      shareState({
        ...input,
        postData: { ...input.postData, a: 'corrupt' },
      })
    ).rejects.toThrow('integrity');
    expect(serverMocks.upload).not.toHaveBeenCalled();
  });
});
