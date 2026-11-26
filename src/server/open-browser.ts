import { spawn } from 'node:child_process';

/** Opens a URL in the default browser. The URL is passed as an argument, never through a shell. */
export function openBrowser(url: string, onError: (error: Error) => void = () => {}): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const child = spawn(command, [url], { stdio: 'ignore', detached: true });
  child.on('error', onError);
  child.unref();
}
