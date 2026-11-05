#!/usr/bin/env bash
# ⚠ DEPRECATED / 已废弃：2D 脸部贴图路线已被否决并彻底删除。
# 当前构建坚持纯 3D 几何（texturedMeshes === 0），本脚本不被任何流程引用，
# 所依赖的 assets/art/ 原图也不在仓库中；保留文件仅作历史演进记录。
# ---------------------------------------------------------------------------
# 把 AI 绘制的头部立绘转成可内联的透明 WebP 贴图。
# 用法：scripts/prepare-faces.sh [黑发原图.png] [金发原图.png]
# 依赖：ImageMagick（magick）。换图后重跑本脚本，再执行 npm run build。
#
# 关键点：
# 1) 生成图往往是白底 RGB，不能直接贴到 3D 头上；
# 2) 不能按颜色直接抠白（眼白会被一起抠掉），必须从四角 floodfill 连通背景；
# 3) 第二张用 image-to-image 改发色，轮廓与第一张一致，因此复用第一张的
#    alpha 蒙版最干净——顺带把第二张的棋盘格背景与角落水印一并清除；
# 4) alpha 腐蚀 1px 去掉抗锯齿残留的白边，WebP 用 alpha 无损避免边缘渗白。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RIN_SRC="${1:-$ROOT/assets/art/Original_adult_anime_female_fi_2026-11-04T13-29-14.png}"
FEI_SRC="${2:-$ROOT/assets/art/Keep_the_exact_same_character__2026-11-04T13-30-51.png}"
OUT="$ROOT/assets/faces"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

magick "$RIN_SRC" -alpha on -fuzz 22% -fill none -floodfill +0+0 white "$TMP/rin.png"
magick "$TMP/rin.png" -channel A -morphology Erode Disk:1 +channel "$TMP/rin-cut.png"
magick "$TMP/rin-cut.png" -alpha extract "$TMP/mask.png"
magick "$FEI_SRC" -resize '1024x1024!' "$TMP/fei-rgb.png"
magick "$TMP/fei-rgb.png" "$TMP/mask.png" -alpha off -compose CopyOpacity -composite "$TMP/fei-cut.png"

for pair in "rin-cut:rin" "fei-cut:fei"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  magick "$TMP/$src.png" -resize 768x768 \
    -define webp:lossless=false -quality 90 -define webp:alpha-quality=100 \
    "$OUT/$dst.webp"
done

for f in "$OUT/rin.webp" "$OUT/fei.webp"; do
  magick "$f" -format "%f  %wx%h  corner=%[pixel:p{0,0}]  " info:
  magick "$f" -alpha extract -format "mean-alpha=%[fx:mean]\n" info:
done
