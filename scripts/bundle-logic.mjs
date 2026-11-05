/**
 * 把纯逻辑层（core/* + Fighter + AI）打包成一个 ESM 文件供 node --test 直接 import。
 *
 * 为什么不用 node 直接跑 .ts：源码的相对 import 不带扩展名，且逻辑层是 Vite/TS
 * 模块图的一部分；esbuild 是 vite 的既有依赖，用它做一次零配置的 bundle 最稳，
 * 也让单测与生产构建消费的是同一份源码，不会出现「测试里另写一份规则」。
 *
 * 只打包不依赖 DOM/WebGL 的模块：帧表、判定框、状态机、角色、AI、比赛流程、输入缓冲。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests/.build');
fs.mkdirSync(outDir, { recursive: true });

const entry = `
export * as frames from './src/core/frames.ts';
export * as hitbox from './src/core/hitbox.ts';
export * as state from './src/core/state.ts';
export * as input from './src/core/input.ts';
export * as fighter from './src/fighter/Fighter.ts';
export * as ai from './src/fighter/AI.ts';
export * as match from './src/core/match.ts';
`;

await build({
  stdin: {
    contents: entry,
    resolveDir: root,
    sourcefile: 'logic-entry.ts',
    loader: 'ts',
  },
  outfile: path.join(outDir, 'logic.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'silent',
});

console.log(`逻辑层已打包 → ${path.relative(root, path.join(outDir, 'logic.mjs'))}`);
