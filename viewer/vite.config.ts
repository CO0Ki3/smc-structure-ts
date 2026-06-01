import { defineConfig, loadEnv } from 'vite';
import { readFileSync, existsSync } from 'fs';
import { join, normalize } from 'path';
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
        // 데이터 파일(.csv/.jsonl)을 매 요청 시 디스크에서 직접 읽어 서빙.
        // Vite(sirv) 정적 서버는 (1) 서버 시작 후 새로 생긴 파일 경로를 못 찾고
        // (2) fs.strict로 워크스페이스 밖 심볼릭 링크를 막아, 실거래 신호로그
        // (live2/all_signals.csv → logs2 심링크)가 index.html로 폴백됐다.
        // 이 미들웨어는 readFileSync로 심링크를 따라 원본을 읽어 우회한다.
        name: 'serve-data-files',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = (req.url || '').split('?')[0];
            if (!/\.(csv|jsonl)$/.test(url)) return next();
            // 경로 탈출 방지 후 public 하위로 매핑
            const rel = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
            const fp = join(__dirname, 'public', rel);
            if (!fp.startsWith(join(__dirname, 'public')) || !existsSync(fp)) return next();
            try {
              const body = readFileSync(fp); // 심링크 추종 → logs2 실시간 내용
              res.setHeader('Content-Type', url.endsWith('.csv')
                ? 'text/csv; charset=utf-8'
                : 'application/x-ndjson; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.end(body);
            } catch {
              next();
            }
          });
        },
      },
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
