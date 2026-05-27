import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  return {
    server: {
      port: 5173,
      allowedHosts: true,
    },
    plugins: [
      {
        name: 'inject-dashboard-env',
        configureServer(server) {
          server.middlewares.use('/dashboard.html', (_req, res) => {
            const html = readFileSync(join(__dirname, 'public/dashboard.html'), 'utf-8');
            const injected = html.replace(
              '__DASHBOARD_PASSWORD__',
              JSON.stringify(env.VITE_DASHBOARD_PASSWORD || '')
            );
            res.setHeader('Content-Type', 'text/html');
            res.end(injected);
          });
        },
      },
    ],
  };
});
