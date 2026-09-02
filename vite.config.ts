import path from 'path';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

export default defineConfig(({ mode }): UserConfig => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_CMS_HOST,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Authorization', `Bearer ${env.VITE_CMS_TOKEN}`);
            });
          },
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      minify: 'terser',
      emptyOutDir: true,
      outDir: 'dist',
      sourcemap: true,
      lib: {
        entry: path.resolve(import.meta.dirname, 'src/index.ts'),
        name: 'ionian',
        formats: ['es', 'iife'],
      },
      rollupOptions: {
        external: ['three', 'three-stdlib'],
        output: {
          globals: {
            three: 'THREE',
            'three-stdlib': 'three-stdlib',
          },
        },
      },
    },
  };
});
