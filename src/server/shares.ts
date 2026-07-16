import { context, media, reddit } from '@devvit/web/server';
import {
  MAX_SHARED_POST_DATA_BYTES,
  decodeSharedState,
  measurePostDataBytes,
  withSharedStatePreview,
} from '../shared/sharedState';
import type {
  SharedStateCommentInput,
  SharedStateShareInput,
  SharedStateShareResult,
} from '../shared/sharedState';

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

const sanitizePostTitle = (title: string) => {
  return title.replace(/\s+/g, ' ').trim().slice(0, 120);
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

const getDataUrlBytes = (dataUrl: string) => {
  const commaIndex = dataUrl.indexOf(',');

  if (commaIndex < 0) {
    throw new Error('Invalid preview data URL');
  }

  const header = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);

  return header.includes(';base64')
    ? Math.floor((payload.length * 3) / 4)
    : new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
};

const uploadPreview = async (input: SharedStateShareInput) => {
  if (input.previewKind === 'hidden') {
    return null;
  }

  if (!input.previewDataUrl) {
    throw new Error('A preview is required for this share mode');
  }

  if (getDataUrlBytes(input.previewDataUrl) > MAX_PREVIEW_BYTES) {
    throw new Error('Preview is too large for Reddit upload');
  }

  const uploaded = await media.upload({
    url: input.previewDataUrl,
    type: input.previewKind,
  });

  return uploaded.mediaUrl;
};

export const shareState = async (
  input: SharedStateShareInput
): Promise<SharedStateShareResult> => {
  const subredditName = getRequiredSubredditName();

  if (measurePostDataBytes(input.postData) > MAX_SHARED_POST_DATA_BYTES) {
    throw new Error('Save state exceeds the safe post-data limit');
  }

  decodeSharedState(input.postData);

  const mediaUrl = await uploadPreview(input);
  const postData = withSharedStatePreview(
    input.postData,
    mediaUrl,
    input.previewKind
  );
  const postDataBytes = measurePostDataBytes(postData);

  if (postDataBytes > MAX_SHARED_POST_DATA_BYTES) {
    throw new Error(
      `Save state needs ${postDataBytes} post-data bytes; the safe limit is ${MAX_SHARED_POST_DATA_BYTES}`
    );
  }

  const title = sanitizePostTitle(input.title);
  const userGeneratedContent = mediaUrl
    ? {
        text: `Shared an EmuArcade checkpoint for ${postData.g}.`,
        imageUrls: [mediaUrl],
      }
    : {
        text: `Shared a hidden EmuArcade checkpoint for ${postData.g}.`,
      };
  const post = await reddit.submitCustomPost({
    entry: 'shared',
    postData,
    runAs: 'USER',
    spoiler: input.previewKind === 'hidden',
    subredditName,
    textFallback: {
      text: `Play this ${postData.g} checkpoint in EmuArcade. You need to provide your own matching ROM.`,
    },
    title,
    userGeneratedContent,
  });

  return {
    mediaUrl,
    postDataBytes,
    postId: post.id,
    postUrl: getPostUrl(post.permalink),
    subredditName,
  };
};

const isPostId = (value: string): value is `t3_${string}` => {
  return /^t3_[a-z0-9]+$/i.test(value);
};

export const shareStateComment = async (input: SharedStateCommentInput) => {
  if (!isPostId(input.postId)) {
    throw new Error('Invalid post ID');
  }

  const comment = await reddit.submitComment({
    id: input.postId,
    runAs: 'USER',
    text: input.text.trim(),
  });

  return { commentId: comment.id };
};
