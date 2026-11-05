# 素材与依赖致谢 / Credits & Attributions

## 随仓库分发的第三方素材

### `assets/character.vrm` — "Rose"

此文件是本仓库**唯一**随源码分发的第三方素材，仅作为 VRM 插槽演示的输入。
下列字段全部读取自文件内嵌的 glTF / VRM 元数据，可用本仓库脚本复核：

```bash
node scripts/inspect-vrm.mjs assets/character.vrm
```

| 字段（glTF `extensions.VRM.meta`） | 值 |
|---|---|
| `title` | Rose |
| `version` | 1.0 |
| `author` | Polygonal Mind |
| `contactInformation` | www.polygonalmind.com |
| `licenseName` | **CC0** |
| `allowedUserName` | Everyone |
| `commercialUssageName` | Allow |
| `violentUssageName` | Allow |
| `sexualUssageName` | Allow |
| `otherPermissionUrl` / `reference` | （空） |

- 生成器 `UniGLTF-1.28`，VRM 0.x，52 根 humanoid 骨骼；所有图片与 buffer 均内嵌，无外部引用（`externalRefs: []`）。
- 许可为 **CC0 1.0 Universal**（公共领域贡献）：无署名义务，允许商业使用、修改与再分发。此处列出处是为了透明，而非许可要求。
- 用途：`scripts/inline.mjs` 把它内联进 `kof-3d-vrm.html`（可替换资产槽演示版，本地生成、不入库）。
- **默认的 `kof-3d.html` 不使用此模型**：角色是纯 3D 程序化几何，零贴图、零第三方模型、零外部请求。

**English**: The only bundled third-party asset is `assets/character.vrm` ("Rose" by Polygonal Mind), released under CC0 according to its embedded VRM metadata. It is used solely by the optional VRM-slot demo build; the default offline build contains no third-party model or texture.

## 由 npm 安装的依赖（不随本仓库分发源码）

| 依赖 | 用途 | 许可证 |
|---|---|---|
| `three` | 3D 渲染运行时 | MIT |
| `@pixiv/three-vrm` | VRM 加载与 humanoid 映射 | MIT |
| `vite` / `typescript` / `esbuild` / `puppeteer-core` | 构建、类型检查、单测打包、浏览器自检 | 见各自 npm 包内 LICENSE |

版本锁定在 `package-lock.json`；本仓库不内嵌这些包的源码。

## 不入库的本地素材

早期资产调研下载的 VRM 候选、AI 立绘与抠图结果（`assets/candidates/`、`assets/art/`、`assets/faces/`），以及自检截图 `shots/`、两份单文件 HTML 产物，都列在 `.gitignore` 中，**不随本仓库公开**。

## 商标声明 / Trademark

`kof-3d` 是本项目沿用的历史代号，与 SNK CORPORATION 及 "THE KING OF FIGHTERS" 系列没有任何关联、授权或背书。项目不使用任何 SNK 角色、美术或商标素材，玩法仅作致敬式借鉴。
