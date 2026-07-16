import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type {
  AppInfo,
  ClipShareInput,
  ClipShareResult,
  LaunchInput,
  LaunchResult,
  ViewerState,
} from './emulator';

export type TrpcContext = {
  getAppInfo: () => Promise<AppInfo>;
  getViewerState: () => Promise<ViewerState>;
  recordLaunch: (input: LaunchInput) => Promise<LaunchResult>;
  shareClip: (input: ClipShareInput) => Promise<ClipShareResult>;
};

const emulatorCoreSchema = z.enum([
  'nes',
  'snes',
  'segaMS',
  'segaMD',
  'segaGG',
  'gb',
  'gba',
  'n64',
  'nds',
  'psx',
  'psp',
  'atari2600',
  'atari7800',
  'lynx',
  'pce',
  'vb',
  'ngp',
  'ws',
  'coleco',
  'arcade',
]);

const launchInputSchema = z.object({
  core: emulatorCoreSchema,
  title: z.string().min(1).max(120),
});

export const clipShareInputSchema = z.object({
  dataUrl: z
    .string()
    .max(28_000_000)
    .refine(
      (value) =>
        value.startsWith('data:video/') || value.startsWith('data:image/gif'),
      { message: 'Clip must be a video or GIF data URL' }
    ),
  thumbnailDataUrl: z
    .string()
    .startsWith('data:image/')
    .max(3_000_000)
    .nullable(),
  mimeType: z.string().min(1).max(80),
  shareFormat: z.enum(['video', 'gif']),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  durationMs: z.number().int().positive().max(60_000),
  gameTitle: z.string().min(1).max(120),
  core: emulatorCoreSchema,
  postTitle: z.string().trim().min(1).max(120).optional(),
}).refine(
  (input) =>
    input.shareFormat === 'gif'
      ? input.dataUrl.startsWith('data:image/gif') &&
        input.mimeType === 'image/gif'
      : input.dataUrl.startsWith('data:video/') &&
        input.mimeType.startsWith('video/'),
  {
    message: 'Clip data must match the selected share format',
    path: ['dataUrl'],
  }
);

const t = initTRPC.context<TrpcContext>().create();

export const appRouter = t.router({
  appInfo: t.procedure.query(async ({ ctx }) => {
    return await ctx.getAppInfo();
  }),
  viewerState: t.procedure.query(async ({ ctx }) => {
    return await ctx.getViewerState();
  }),
  recordLaunch: t.procedure
    .input(launchInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.recordLaunch(input);
    }),
  shareClip: t.procedure
    .input(clipShareInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.shareClip(input);
    }),
});

export type AppRouter = typeof appRouter;
