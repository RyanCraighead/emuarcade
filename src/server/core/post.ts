import { reddit } from '@devvit/web/server';

export const createPost = async () => {
  return await reddit.submitCustomPost({
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
};
