// The Vite dev server for QA runs, with HMR and file watching off: a file saved during a run must not reload the page
// and restart a fight halfway.   node tools/qa/serve.mjs [port]   (default 5352; tools/qa/browser.mjs startVite)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const [portArg = '5352'] = process.argv.slice(2);
const port = Number(portArg);

const dev = await createServer({
  root: appDir,
  configFile: path.join(appDir, 'vite.config.js'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },   // (watch nothing)
});
await dev.listen();
console.log(`QA dev server: http://127.0.0.1:${port}/ (HMR and file watching off)`);

// TERM or INT (startVite's kill, Ctrl-C): close the server once, then leave cleanly
let closing = null;
const shutdown = () => { closing ??= dev.close().finally(() => process.exit(0)); };
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, shutdown);
