declare module '*.css';

declare module '@devvit/web/client' {
  export const requestExpandedMode: (event: Event, entrypoint?: string) => void;
}
