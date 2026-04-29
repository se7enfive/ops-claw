import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    ssr: {
      external: ['electron']
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    server: {
      host: '0.0.0.0', // 同时监听 IPv4 和 IPv6，解决 Windows 连接问题
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
