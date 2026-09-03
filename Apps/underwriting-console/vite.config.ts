import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { parseMiddleware } from './src/server/parseMiddleware';
import { summaryPdfMiddleware } from './src/server/summaryPdfMiddleware';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'freeflow-summary-pdf',
      configureServer(server) {
        server.middlewares.use(parseMiddleware());
        server.middlewares.use(summaryPdfMiddleware());
      },
    },
  ],
  server: {
    port: 3000,
    host: true,
    strictPort: true,
  },
});
