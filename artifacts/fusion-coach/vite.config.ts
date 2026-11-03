import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const DEFAULT_PORT = 5000;

// Fall back to the default when PORT is unset or unusable (e.g. a shell that
// exports PORT=0), so local `pnpm dev` always serves on localhost without crashing.
const rawPort = process.env.PORT?.trim() ?? '';
const parsedPort = Number(rawPort);
const hasUsablePort =
  rawPort !== '' && Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535;
if (rawPort !== '' && !hasUsablePort) {
  console.warn(
    `[vite-config] Ignoring unusable PORT "${rawPort}" — serving on ${DEFAULT_PORT} instead.`,
  );
}
const port = hasUsablePort ? parsedPort : DEFAULT_PORT;

const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:5001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:5001',
        changeOrigin: true,
      },
    },
  },
});
