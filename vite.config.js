import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages hosts this repository under /router.esports-/.
  // Local development keeps the normal root path.
  base: command === 'build' ? '/router.esports-/' : '/',
}));
