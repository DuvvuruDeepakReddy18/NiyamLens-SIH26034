import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Prebundle the lazy report dependency so first export cannot reload an active inspection in development.
  optimizeDeps: { include: ['docx'] },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
