#!/bin/bash

# setup.sh - OpenWeather API Router 项目设置脚本

set -e

echo "🌤️ ==============================================="
echo "🌤️  OpenWeather API Router 项目设置"
echo "🌤️ ==============================================="

# 检查Node.js版本
echo "📋 检查Node.js版本..."
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到Node.js，请先安装Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
REQUIRED_VERSION="18.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ 错误: Node.js版本过低 ($NODE_VERSION)，需要18.0.0+"
    exit 1
fi

echo "✅ Node.js版本: $NODE_VERSION"

# 检查npm版本
echo "📋 检查npm版本..."
NPM_VERSION=$(npm -v)
echo "✅ npm版本: $NPM_VERSION"

# 创建必要的目录
echo "📁 创建项目目录..."
mkdir -p logs
mkdir -p tests
mkdir -p docs
chmod 755 logs

echo "✅ 目录创建完成"

# 复制环境变量文件
echo "⚙️ 设置环境变量..."
if [ ! -f .env ]; then
    if [ -f env.example ]; then
        cp env.example .env
        echo "✅ 已创建.env文件，请编辑并添加您的API密钥"
        echo "📝 编辑 .env 文件: nano .env"
    else
        echo "❌ 警告: 未找到env.example文件"
    fi
else
    echo "ℹ️ .env文件已存在"
fi

# 安装依赖
echo "📦 安装项目依赖..."
if [ -f package.json ]; then
    npm install
    echo "✅ 依赖安装完成"
else
    echo "❌ 错误: 未找到package.json文件"
    exit 1
fi

# 运行代码检查
echo "🔍 运行代码检查..."
if npm run lint; then
    echo "✅ 代码检查通过"
else
    echo "⚠️ 代码检查发现问题，请修复后再继续"
fi

# 运行测试
echo "🧪 运行测试套件..."
if npm test; then
    echo "✅ 所有测试通过"
else
    echo "⚠️ 部分测试失败，请检查配置"
fi

# 创建Git忽略文件
echo "📝 创建.gitignore文件..."
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env.test

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# next.js build output
.next

# nuxt.js build output
.nuxt

# vuepress build output
.vuepress/dist

# Serverless directories
.serverless

# FuseBox cache
.fusebox/

# DynamoDB Local files
.dynamodb/

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# PM2 files
.pm2/

# Docker
.dockerignore

# Backup files
*.backup
*.bak
EOF

echo "✅ .gitignore文件创建完成"

# 显示配置提示
echo ""
echo "🎉 项目设置完成！"
echo ""
echo "📋 下一步操作:"
echo "1. 编辑 .env 文件，添加您的OpenWeatherMap API密钥"
echo "   nano .env"
echo ""
echo "2. 启动开发服务器:"
echo "   npm run dev"
echo ""
echo "3. 生产环境部署:"
echo "   npm start"
echo ""
echo "4. 使用PM2集群部署:"
echo "   npm run pm2:start"
echo ""
echo "5. Docker部署:"
echo "   docker-compose up -d"
echo ""
echo "📡 服务端点:"
echo "   主要接口: http://localhost:3000/data/3.0/onecall"
echo "   健康检查: http://localhost:3000/health"
echo "   使用统计: http://localhost:3000/stats"
echo "   使用示例: http://localhost:3000/data/3.0/examples"
echo ""
echo "📖 更多信息请查看 README.md 文件"
echo ""
echo "🌤️ ==============================================="
echo "🌤️  设置完成，祝您使用愉快！"
echo "🌤️ ===============================================" 