import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev the backend runs beside this app; /api is passed on to it so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:4000' },
  },
})
