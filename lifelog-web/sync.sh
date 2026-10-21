#!/usr/bin/env bash
# WorkBuddy 版：一键「构建 + 同步到 web/ 发布目录」
# 用法：在项目目录运行  bash sync.sh  （Windows 双击 同步.bat）
# 跑完后回到 WorkBuddy 说一句「发布一下」即可上线。
set -e
cd "$(dirname "$0")"

echo "==> 1/3 提交本地改动（有 git 时）"
if [ -d .git ] && [ -n "$(git status --porcelain)" ]; then
  git add -A
  git -c user.name="lifelog" -c user.email="lifelog@local" commit -m "sync: $(date '+%Y-%m-%d %H:%M:%S')" || true
  echo "    已提交"
else
  echo "    跳过"
fi

echo "==> 2/3 构建 WorkBuddy 版"
# 每次发布把 Service Worker 缓存版本号加一，否则手机上的旧缓存不会被清理
SW=public/sw.js
if [ -f "$SW" ]; then
  CUR=$(grep -o "lifelog-v[0-9]*" "$SW" | head -1 | grep -o "[0-9]*")
  NEXT=$(( ${CUR:-1} + 1 ))
  sed -i.bak "s/lifelog-v[0-9]*/lifelog-v$NEXT/" "$SW" && rm -f "$SW.bak"
  echo "    Service Worker 缓存版本 -> v$NEXT"
fi
# vite 8 和 esbuild 0.25 的 peer 依赖声明冲突，全新安装要加 --legacy-peer-deps
[ -d node_modules ] || npm install --legacy-peer-deps
npx vite build

echo "==> 3/3 同步到 web/"
rm -rf web/assets && mkdir -p web/assets
cp dist/assets/* web/assets/
cp dist/index.html web/index.html
cp dist/manifest.webmanifest dist/sw.js dist/icon-192.png dist/icon-512.png dist/apple-touch-icon.png web/ 2>/dev/null || true

echo ""
echo "完成。回到 WorkBuddy 说一句「发布一下」即可上线。"
echo "线上地址：https://life-ledger-17434.app.workbuddy.host/"
