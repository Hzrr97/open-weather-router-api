# 使用官方Node.js 18 Alpine镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# 创建日志目录
RUN mkdir -p /app/logs && chmod 755 /app/logs

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S weather -u 1001 -G nodejs

# 复制package文件
COPY package*.json ./

# 安装依赖 (仅生产依赖)
RUN npm ci --only=production && \
    npm cache clean --force

# 复制源代码
COPY src/ ./src/
COPY ecosystem.config.js ./
COPY env.example ./.env.example

# 设置文件权限
RUN chown -R weather:nodejs /app

# 切换到非root用户
USER weather

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 使用dumb-init作为PID 1进程
ENTRYPOINT ["dumb-init", "--"]

# 启动应用
CMD ["node", "src/app.js"]

# 标签信息
LABEL maintainer="Your Name <your.email@example.com>" \
      version="1.0.0" \
      description="OpenWeather API Router - High Performance Weather Data Proxy" \
      org.opencontainers.image.source="https://github.com/your-username/open-weather-router-api" 