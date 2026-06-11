import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { context, reddit } from '@devvit/web/server';
import { appRouter } from '../shared/trpc';
import type { TrpcContext } from '../shared/trpc';
import type { ClipShareInput, LaunchInput } from '../shared/emulator';
import { shareClip } from './clips';

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
