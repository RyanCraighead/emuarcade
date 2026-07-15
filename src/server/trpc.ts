import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { context, reddit, redis } from '@devvit/web/server';
import { createHash } from 'node:crypto';
import { appRouter } from '../shared/trpc';
import type { TrpcContext } from '../shared/trpc';
import type { ClipShareInput, LaunchInput } from '../shared/emulator';
import { shareClip } from './clips';

const PLAYER_SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const getViewerId = () => {
  try {
    return context.userId;
  } catch {
    return undefined;
  }
};

const getPlayerSeenKey = (userId: string) => {
  const viewerHash = createHash('sha256')
    .update(userId)
    .digest('hex')
    .slice(0, 32);

  return `player-seen:v1:${viewerHash}`;
};

const createTrpcContext = (): TrpcContext => {
  return {
    getAppInfo: async () => {
      const username = await reddit.getCurrentUsername();

      return {
        username: username ?? 'anonymous',
        subredditName: context.subredditName ?? 'unknown',
        postId: context.postId ?? null,
        launchCount: 0,
      };
    },
    getViewerState: async () => {
      const userId = getViewerId();

      if (!userId) {
        return {
          isAuthenticated: false,
          isNewPlayer: false,
        };
      }

      const key = getPlayerSeenKey(userId);
      const existing = await redis.get(key);

      if (existing === undefined) {
        const expiration = new Date(
          Date.now() + PLAYER_SEEN_TTL_SECONDS * 1_000
        );
        const result = await redis.set(key, '1', {
          expiration,
          nx: true,
        });

        return {
          isAuthenticated: true,
          isNewPlayer: result === 'OK',
        };
      }

      await redis.expire(key, PLAYER_SEEN_TTL_SECONDS);

      return {
        isAuthenticated: true,
        isNewPlayer: false,
      };
    },
    recordLaunch: async (input: LaunchInput) => {
      console.info('Local launch', {
        core: input.core,
        title: input.title,
      });

      return { launchCount: 0 };
    },
    shareClip: async (input: ClipShareInput) => {
      return await shareClip(input);
    },
  };
};

export const handleTrpcRequest = async (request: Request) => {
  return await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: request,
    router: appRouter,
    createContext: createTrpcContext,
  });
};
