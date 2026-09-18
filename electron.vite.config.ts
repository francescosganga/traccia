import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'whisper-worker': resolve(__dirname, 'src/main/whisper-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          region: resolve(__dirname, 'src/renderer/region.html'),
          controls: resolve(__dirname, 'src/renderer/controls.html')
        }
      }
    }
  }
})
