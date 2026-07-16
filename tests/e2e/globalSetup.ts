import path from 'node:path';
import { createServer } from 'vite';

const host = '127.0.0.1';
const port = 4187;

const globalSetup = async () => {
  const server = await createServer({
    clearScreen: false,
    configFile: path.resolve('vite.local.config.ts'),
    server: {
      host,
      port,
      strictPort: true,
    },
  });

  await server.listen();

  return async () => {
    await server.close();
  };
};

export default globalSetup;
