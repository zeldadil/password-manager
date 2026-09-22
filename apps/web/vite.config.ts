import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 6 config for the web app.
export default defineConfig({
  plugins: [react()],
})
