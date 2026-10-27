import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One app, two builds:
//   npm run build         -> normal website (Firebase when VITE_FIREBASE_* are set,
//                            otherwise demo mode with data saved in the browser)
//   npm run build:hosted  -> claude.ai artifact build (hash routing, relative paths)
export default defineConfig(({ mode }) => {
  const hosted = mode === 'hosted';
  return {
    base: hosted ? './' : '/',
    plugins: [react()],
    define: hosted ? { 'import.meta.env.VITE_HOSTED': JSON.stringify('1') } : {},
    build: {
      outDir: hosted ? 'dist-hosted' : 'dist',
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          },
        },
      },
    },
  };
});
