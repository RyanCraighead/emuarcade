import {
  context,
  media,
  reddit,
  RichTextBuilder,
} from '@devvit/web/server';
import type { ClipShareInput, ClipShareResult } from '../shared/emulator';

const MAX_CLIP_BYTES = 20 * 1024 * 1024;

const sanitizePostTitle = (title: string) => {
  return title.replace(/\s+/g, ' ').trim().slice(0, 120);
};

const formatClipSeconds = (durationMs: number) => {
  return `${Math.max(1, Math.round(durationMs / 1000))}s`;
};

const getRequiredSubredditName = () => {
  if (!context.subredditName) {
    throw new Error('subredditName is required');
  }

  return context.subredditName;
};

const getPostUrl = (permalink: string) => {
  return `https://www.reddit.com${permalink}`;
};

const shareVideoClip = async (
  input: ClipShareInput,
  subredditName: string
): Promise<ClipShareResult> => {
  const uploaded = await media.upload({
    url: input.dataUrl,
    type: 'video',
  });
  const postTitle = sanitizePostTitle(`EmuArcade clip: ${input.gameTitle}`);
  const richtext = new RichTextBuilder()
    .paragraph((paragraph) => {
      paragraph.text({
        text: `Captured in EmuArcade from ${input.gameTitle} (${formatClipSeconds(
          input.durationMs
        )}).`,
      });
    })
    .video({
      mediaUrl: uploaded.mediaUrl,
      caption: `EmuArcade gameplay clip from ${input.gameTitle}`,
    })
    .paragraph((paragraph) => {
      paragraph.text({
        text: 'Recorded locally and shared after the player chose to post it.',
      });
    });
  const post = await reddit.submitPost({
    subredditName,
    title: postTitle,
    richtext,
  });

  return {
    mediaUrl: uploaded.mediaUrl,
    postId: post.id,
    postUrl: getPostUrl(post.permalink),
    subredditName,
    shareKind: 'video',
  };
};

const sharePreviewImage = async (
  input: ClipShareInput,
  subredditName: string
): Promise<ClipShareResult> => {
  if (!input.thumbnailDataUrl) {
    throw new Error('Video upload failed and no preview image was available');
  }

  const uploaded = await media.upload({
    url: input.thumbnailDataUrl,
    type: 'image',
  });
  const postTitle = sanitizePostTitle(
    `EmuArcade moment: ${input.gameTitle}`
  );
  const richtext = new RichTextBuilder()
    .paragraph((paragraph) => {
      paragraph.text({
        text: `Captured in EmuArcade from ${input.gameTitle} (${formatClipSeconds(
          input.durationMs
        )}).`,
      });
    })
    .image({
      mediaUrl: uploaded.mediaUrl,
      caption: `EmuArcade gameplay preview from ${input.gameTitle}`,
    })
    .paragraph((paragraph) => {
      paragraph.text({
        text: 'Video upload was unavailable, so EmuArcade shared the captured preview frame.',
      });
    });
  const post = await reddit.submitPost({
    subredditName,
    title: postTitle,
    richtext,
  });

  return {
    mediaUrl: uploaded.mediaUrl,
    postId: post.id,
    postUrl: getPostUrl(post.permalink),
    subredditName,
    shareKind: 'image',
  };
};

const shareGifClip = async (
  input: ClipShareInput,
  subredditName: string
): Promise<ClipShareResult> => {
  const uploaded = await media.upload({
    url: input.dataUrl,
    type: 'image',
  });
  const postTitle = sanitizePostTitle(`EmuArcade GIF: ${input.gameTitle}`);
  const richtext = new RichTextBuilder()
    .paragraph((paragraph) => {
      paragraph.text({
        text: `Captured in EmuArcade from ${input.gameTitle} (${formatClipSeconds(
          input.durationMs
        )}).`,
      });
    })
    .image({
      mediaUrl: uploaded.mediaUrl,
      caption: `EmuArcade gameplay GIF from ${input.gameTitle}`,
    })
    .paragraph((paragraph) => {
      paragraph.text({
        text: 'Converted locally to GIF and shared after the player chose to post it.',
      });
    });
  const post = await reddit.submitPost({
    subredditName,
    title: postTitle,
    richtext,
  });

  return {
    mediaUrl: uploaded.mediaUrl,
    postId: post.id,
    postUrl: getPostUrl(post.permalink),
    subredditName,
    shareKind: 'gif',
  };
};

export const shareClip = async (
  input: ClipShareInput
): Promise<ClipShareResult> => {
  const subredditName = getRequiredSubredditName();

  if (input.sizeBytes > MAX_CLIP_BYTES) {
    throw new Error('Clip is too large for Reddit upload');
  }

  if (input.shareFormat === 'gif') {
    return await shareGifClip(input, subredditName);
  }

  try {
    return await shareVideoClip(input, subredditName);
  } catch (error) {
    console.error('Video clip share failed; falling back to image', error);
    return await sharePreviewImage(input, subredditName);
  }
};
