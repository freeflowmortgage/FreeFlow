import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import path from 'node:path';
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

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const runtimeMode = process.env.VITE_FREEFLOW_RUNTIME_MODE || (process.env.NODE_ENV === 'production' ? 'protected-web' : 'demo');
if (!['demo', 'qa', 'protected-web', 'encompass-hosted'].includes(runtimeMode)) throw new Error('FREEFLOW_CONSOLE_MODE_INVALID');
if (process.env.NODE_ENV === 'production' && !['protected-web', 'encompass-hosted'].includes(runtimeMode)) throw new Error('FREEFLOW_CONSOLE_DEMO_MODE_FORBIDDEN_IN_PRODUCTION');
const demoRuntime = runtimeMode === 'demo' || runtimeMode === 'qa';

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  define: {
    __APP_REVISION__: JSON.stringify(revision),
  },
  plugins: [
    react(),
    ...(demoRuntime ? [{
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
    }] : []),
  ],
  resolve: {
    alias: {
      '@console-runtime-app': path.resolve(__dirname, demoRuntime ? 'src/App.tsx' : 'src/ProtectedApp.tsx'),
      '@console-document-loader': path.resolve(__dirname, demoRuntime ? 'src/postParsePdf.ts' : 'src/postParsePdf.protected.ts'),
    },
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    host: true,
    strictPort: true,
    // Do not disable Vite's Host-header protection. ECS supplies the known
    // ALB and custom-domain hosts through VITE_ALLOWED_HOSTS at deployment.
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
  },
});
