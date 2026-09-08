import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { parseMiddleware } from './src/server/parseMiddleware';
import { summaryPdfMiddleware } from './src/server/summaryPdfMiddleware';
import { intakeDeliverMiddleware } from './src/server/intakeDeliverMiddleware';
import { appraisalAuditMiddleware } from './src/server/appraisalAuditMiddleware';

const revision = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  define: {
    __APP_REVISION__: JSON.stringify(revision),
  },
  plugins: [
    react(),
    {
      name: 'freeflow-appraisal-audit',
      configureServer(server) {
        server.middlewares.use(appraisalAuditMiddleware());
      },
    },
    {
      name: 'freeflow-summary-pdf',
      configureServer(server) {
        server.middlewares.use(parseMiddleware());
        server.middlewares.use(summaryPdfMiddleware());
        server.middlewares.use(intakeDeliverMiddleware());
      },
    },
  ],
  server: {
    port: Number(process.env.PORT) || 3000,
    host: true,
    strictPort: true,
  },
});
