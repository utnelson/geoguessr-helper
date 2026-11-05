import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Im Dev-Modus leitet Vite /api und /uploads an das lokale Backend weiter.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
});
