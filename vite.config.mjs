import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  // Keep default base neutral; scripts override it for web/electron builds.
  base: '/',
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
  }
});
