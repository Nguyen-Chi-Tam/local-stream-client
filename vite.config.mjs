import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  // Use relative paths so Electron's file:// protocol can load assets correctly
  base: './',
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
  },
  build: {
    outDir: 'dist',
  }
});
