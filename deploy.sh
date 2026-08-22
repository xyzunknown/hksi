#!/bin/bash

echo "🚀 开始部署 HKSI 学习中心到 Vercel"

# 检查是否有未提交的更改
if ! git diff-index --quiet HEAD --; then
    echo "⚠️  发现未提交的更改，正在提交..."
    git add .
    git commit -m "自动部署更新 $(date '+%Y-%m-%d %H:%M:%S')"
fi

# 推送到 GitHub
echo "📤 推送到 GitHub..."
git push origin main

echo ""
echo "✅ 代码已推送到 GitHub"
echo "📝 Vercel 会自动检测 GitHub 的推送并开始部署"
echo ""
echo "📋 部署状态可以在这里查看："
echo "   - GitHub Actions: https://github.com/xyzunknown/hksi/actions"
echo "   - Vercel Dashboard: https://vercel.com/xyzunknown/hksi"
echo ""
echo "🌐 部署完成后访问："
echo "   - https://hksi.vercel.app"
echo ""

# 等待一段时间让部署开始
echo "⏳ 等待 10 秒让 Vercel 开始部署..."
sleep 10

echo "🎉 部署流程已启动！请查看上述链接获取部署状态。"