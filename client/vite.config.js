import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    historyApiFallback: true,
    proxy: {
      '/auth': 'http://localhost:4000',
      '/anime': 'http://localhost:4000',
      '/ratings': 'http://localhost:4000',
      '/api': 'http://localhost:4000',
      '/system': 'http://localhost:4000'
    }
  },
  build: {
    outDir: 'dist'
  }
});
