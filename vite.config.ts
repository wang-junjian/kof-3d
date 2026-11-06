import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        // 显式对齐 scripts/inline.mjs 用普通 <script> 内联的假设：iife 让 rollup
        // 主动处理 / 拒绝 import.meta，避免未来默认 esm 输出引入模块语法。
        format: 'iife',
        entryFileNames: 'game.js',
        assetFileNames: 'game.[ext]',
      },
    },
  },
});
