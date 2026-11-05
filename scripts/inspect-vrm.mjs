// 只读 VRM/GLB 审计：不解析贴图内容、不执行任何内嵌数据，仅检查结构与许可元数据。
// 用法: node scripts/inspect-vrm.mjs <file.vrm> [...]
import fs from 'node:fs';
import path from 'node:path';

function inspect(file) {
  const buf = fs.readFileSync(file);
  const out = { file: path.basename(file), bytes: buf.length, ok: true, issues: [] };

  if (buf.length < 20) { out.ok = false; out.issues.push('文件过短'); return out; }
  const magic = buf.toString('ascii', 0, 4);
  const version = buf.readUInt32LE(4);
  const declared = buf.readUInt32LE(8);
  if (magic !== 'glTF') { out.ok = false; out.issues.push(`magic=${magic} 非 glTF`); return out; }
  if (version !== 2) out.issues.push(`glTF version=${version}`);
  if (declared !== buf.length) {
    out.ok = false;
    out.issues.push(`声明长度 ${declared} != 实际 ${buf.length}（下载不完整或被截断 ${buf.length - declared} 字节）`);
  }

  let off = 12;
  let json = null;
  let binBytes = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (off + 8 + len > buf.length) {
      out.ok = false;
      out.issues.push(`chunk ${type} 越界：需要 ${len} 字节，只剩 ${buf.length - off - 8}`);
      break;
    }
    if (type.startsWith('JSON')) {
      try { json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + len)); }
      catch (e) { out.ok = false; out.issues.push(`JSON chunk 解析失败: ${e.message}`); }
    } else if (type.startsWith('BIN')) binBytes = len;
    off += 8 + len;
  }
  out.binBytes = binBytes;
  out.chunksEnd = off;
  if (!json) { out.ok = false; return out; }

  out.asset = json.asset;
  out.extensionsUsed = json.extensionsUsed || [];
  out.extensionsRequired = json.extensionsRequired || [];
  const ext = json.extensions || {};
  const vrm1 = ext.VRMC_vrm;
  const vrm0 = ext.VRM;
  out.vrmVersion = vrm1 ? '1.0' : vrm0 ? '0.x' : '无 VRM 扩展';

  const meta = vrm1?.meta || vrm0?.meta || {};
  out.meta = {
    name: meta.name || vrm1?.humanoid && undefined,
    authors: meta.authors || meta.author,
    licenseUrl: meta.licenseUrl || meta.licenseName,
    avatarPermission: meta.avatarPermission,
    allowExcessivelyViolentUsage: meta.allowExcessivelyViolentUsage,
    allowExcessivelySexualUsage: meta.allowExcessivelySexualUsage,
    commercialUsage: meta.commercialUsage || meta.allowCommercialUsage,
    allowPoliticalOrReligiousUsage: meta.allowPoliticalOrReligiousUsage,
    allowAntisocialOrHateUsage: meta.allowAntisocialOrHateUsage,
    allowRedistribution: meta.allowRedistribution,
    modification: meta.modification || meta.modificationPermission,
    creditNotation: meta.creditNotation,
    otherLicenseUrl: meta.otherLicenseUrl,
  };

  const humanoid = vrm1?.humanoid?.humanBones || vrm0?.humanoid?.humanBones || {};
  out.humanBones = Object.keys(humanoid).length;
  out.boneNames = Object.keys(humanoid).slice(0, 8);

  out.counts = {
    nodes: json.nodes?.length || 0,
    meshes: json.meshes?.length || 0,
    materials: json.materials?.length || 0,
    textures: json.textures?.length || 0,
    images: json.images?.length || 0,
    animations: json.animations?.length || 0,
    skins: json.skins?.length || 0,
  };

  // 外部引用 = 离线内嵌的最大风险；同时扫一遍所有字符串里的 http(s) 链接
  const external = [];
  for (const im of json.images || []) if (im.uri && !im.uri.startsWith('data:')) external.push(`image: ${im.uri.slice(0, 120)}`);
  for (const b of json.buffers || []) if (b.uri && !b.uri.startsWith('data:')) external.push(`buffer: ${b.uri.slice(0, 120)}`);
  out.externalRefs = external;

  const urls = new Set();
  const walk = (v, depth = 0) => {
    if (depth > 12 || v == null) return;
    if (typeof v === 'string') {
      const m = v.match(/https?:\/\/[^\s"']+/g);
      if (m) m.forEach((u) => urls.add(u.slice(0, 160)));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === 'object') Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk({ extensions: ext, extras: json.extras, asset: json.asset });
  out.urlsInMetadata = [...urls].slice(0, 20);

  out.materialsMToon = (json.materials || []).filter((m) =>
    m.extensions?.VRMC_materials_mtoon || /MToon|VRM\/MToon/i.test(m.name || '')).length;

  return out;
}

for (const f of process.argv.slice(2)) {
  const r = inspect(f);
  console.log('\n' + '='.repeat(72));
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) console.log('❌ 文件不可用');
  else if (r.externalRefs.length) console.log('⚠ 存在外部资源引用，离线内嵌前需处理');
  else console.log('✅ 结构完整，资源全部内嵌');
}
