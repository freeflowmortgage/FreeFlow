import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    strictPort: true,
    proxy: {
      '/parse': 'http://127.0.0.1:8080',
      '/health': 'http://127.0.0.1:8080',
      '/api/underwrite': 'http://127.0.0.1:8080',
    },
  },
});
