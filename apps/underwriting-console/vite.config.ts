import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { parseMiddleware } from './src/server/parseMiddleware';
import { summaryPdfMiddleware } from './src/server/summaryPdfMiddleware';
import { intakeDeliverMiddleware } from './src/server/intakeDeliverMiddleware';

export default defineConfig({
  plugins: [
    react(),
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
    port: 3000,
    host: true,
    strictPort: true,
  },
});
