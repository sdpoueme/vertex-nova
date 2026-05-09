import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3080,
    proxy: {
      '/api': 'http://localhost:3081',
    },
  },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        guest: resolve(__dirname, 'guest-app.html'),
      },
    },
  },
});
