import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// 单文件契约要求恰好一个 JS chunk 和一个 CSS chunk。
// 旧实现遇到多 chunk 会静默用最后一个覆盖前面的，产出能打开但脚本残缺的 HTML。
const jsFiles = fs.readdirSync(dist).filter((f) => f.endsWith('.js'));
const cssFiles = fs.readdirSync(dist).filter((f) => f.endsWith('.css'));
if (jsFiles.length !== 1) {
  throw new Error(`单文件内联只支持 1 个 JS chunk，实际 ${jsFiles.length} 个：${jsFiles.join(', ')}`);
}
if (cssFiles.length > 1) {
  throw new Error(`单文件内联只支持 1 个 CSS chunk，实际 ${cssFiles.length} 个：${cssFiles.join(', ')}`);
}
const js = fs.readFileSync(path.join(dist, jsFiles[0]), 'utf8');
const css = cssFiles.length === 1 ? fs.readFileSync(path.join(dist, cssFiles[0]), 'utf8') : '';

// 构建期不变量（内联前）：产物会被普通 <script> 内联，import.meta 在这种上下文
// 里是 SyntaxError；用全局文本替换去「修」又会误伤字符串字面量，并把
// import.meta.url / import.meta.env.* 悄悄改成错误语义。宁可显式失败，也不静默改写。
// 注意：只统计产物 js 与最终 HTML，不对本脚本源码里的正则字面量计数。
const metaBefore = (js.match(/\bimport\.meta\b/g) ?? []).length;
if (metaBefore !== 0) {
  throw new Error(
    `dist/game.js 仍含 ${metaBefore} 处 import.meta；请在源码层消除或用 vite define 处理，禁止全局文本替换`,
  );
}
// 普通 script 内联，避免 file:// 下 module 的 CORS 限制
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const safeCss = css.replace(/<\/style/gi, '<\\/style');

const jsTag = /<script[^>]*src="[^"]*"[^>]*><\/script>/i;
if (!jsTag.test(html)) throw new Error('未找到待内联的 script 标签');
// 用函数形式替换：压缩产物含 $& / $' 等序列，字符串替换会把它们当成替换模式
// 普通 script 没有 module 的 defer 语义，必须放到 body 末尾，否则 DOM 元素尚未解析
let template = html.replace(jsTag, '');
if (!/<\/body>/i.test(template)) throw new Error('未找到 </body>');
if (css) {
  const cssTag = /<link[^>]*rel="stylesheet"[^>]*>/i;
  if (!cssTag.test(template)) throw new Error('未找到待内联的 stylesheet 标签');
  template = template.replace(cssTag, () => `<style>\n${safeCss}\n</style>`);
}
template = template.replace(/<link[^>]*rel="modulepreload"[^>]*>/gi, '');
template = template.replace(/<link[^>]*rel="preload"[^>]*>/gi, '');
if (template.includes('./game.js') || template.includes('./game.css')) {
  throw new Error('仍有未内联的外部资源引用');
}

// 可替换角色资产槽：把 .vrm 直接内联，保证 file:// 离线双击也能加载。
// 默认版是纯 3D 几何角色，不内联任何图片贴图。
const vrmPath = path.join(root, 'assets/character.vrm');
const vrmBase64 = fs.existsSync(vrmPath) ? fs.readFileSync(vrmPath).toString('base64') : '';
const dataScript = vrmBase64 ? `<script>window.__KOF_VRM__="${vrmBase64}";</script>\n` : '';
// 后置断言（内联后）：最终单文件里同样不允许残留 import.meta（覆盖 CSS 与注入片段）。
const inject = (data) => {
  const out = template.replace(/<\/body>/i, () => `${data}<script>\n${safeJs}\n</script>\n</body>`);
  const metaAfter = (out.match(/\bimport\.meta\b/g) ?? []).length;
  if (metaAfter !== 0) throw new Error(`单文件产物残留 ${metaAfter} 处 import.meta（内联后）`);
  return out;
};

const defaultHtml = inject('');
const out = path.join(root, 'kof-3d.html');
fs.writeFileSync(out, defaultHtml, 'utf8');
console.log(`默认版 ${out} — ${(Buffer.byteLength(defaultHtml, 'utf8') / 1024).toFixed(0)} KB（纯 3D 几何，零贴图）`);

if (vrmBase64) {
  const vrmHtml = inject(dataScript);
  const outVrm = path.join(root, 'kof-3d-vrm.html');
  fs.writeFileSync(outVrm, vrmHtml, 'utf8');
  console.log(`VRM 插槽版 ${outVrm} — ${(Buffer.byteLength(vrmHtml, 'utf8') / 1024).toFixed(0)} KB（内联 assets/character.vrm）`);
} else {
  console.log('角色资产槽：未放入 assets/character.vrm，仅产出默认版');
}
