// vite.config.ts
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      // FIX: Whitelist your custom domain or set to true to allow any host
      allowedHosts: [
        'gemini-live.vktronics.tech',
        'localhost',
        '127.0.0.1'
      ], 
      proxy: {
        '/api': 'http://localhost:8000',
        '/health': 'http://localhost:8000',
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') }
    }
  };
});
