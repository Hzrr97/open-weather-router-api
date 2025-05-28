# 🌤️ OpenWeather API 代理服务

高性能的 OpenWeatherMap OneCall API 代理服务，支持多账号负载均衡和智能请求限制管理。

## ✨ 功能特性

- 🔄 **多账号负载均衡**: 自动轮询多个 OpenWeatherMap API 账号
- 📊 **智能请求限制**: 可配置每个账号每日请求限制管理（默认2000次）
- ⚡ **高性能缓存**: 内存缓存减少重复请求，提升响应速度
- 🛡️ **错误处理**: 完善的错误处理和重试机制
- 📈 **监控统计**: 实时 API 使用情况统计和性能监控
- 🔒 **参数验证**: 严格的输入参数验证，确保请求安全
- 🚀 **高并发支持**: 基于 Fastify 框架，支持万级并发
- 📦 **容器化部署**: 支持 Docker 和 PM2 集群部署

## 🚀 快速开始

### 环境要求

- Node.js 18+
- NPM 或 Yarn
- OpenWeatherMap API 账号 (支持 OneCall 3.0)

### 安装部署

```bash
# 克隆项目
git clone <repository-url>
cd open-weather-router-api

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，添加您的 API 密钥

# 启动开发环境
npm run dev

# 生产环境部署
npm run build
npm start
```

### 环境配置

创建 `.env` 文件：

```bash
# 服务器配置
PORT=3000
NODE_ENV=production

# OpenWeatherMap API密钥 (多个密钥用逗号分隔)
OPENWEATHER_API_KEYS=key1,key2,key3,key4

# API限制配置
API_DAILY_LIMIT=2000

# 缓存配置
CACHE_TTL=300
CACHE_MAX_KEYS=10000

# 日志配置
LOG_LEVEL=info
```

## 📡 API 接口

### 获取天气数据

**请求地址**: `GET /data/3.0/onecall`

**请求参数**:

| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| `lat` | number | ✅ | 纬度，范围 (-90, 90) | 39.9042 |
| `lon` | number | ✅ | 经度，范围 (-180, 180) | 116.4074 |
| `exclude` | string | ❌ | 排除的数据部分，逗号分隔 | current,minutely |
| `units` | string | ❌ | 单位制：standard/metric/imperial | metric |
| `lang` | string | ❌ | 语言代码 | zh_cn |

**exclude 可选值**:
- `current` - 当前天气
- `minutely` - 分钟级预报
- `hourly` - 小时级预报
- `daily` - 每日预报
- `alerts` - 天气预警

**请求示例**:

```bash
# 获取北京当前天气 (公制单位，中文)
curl "http://localhost:3000/data/3.0/onecall?lat=39.9042&lon=116.4074&units=metric&lang=zh_cn"

# 获取纽约天气，排除分钟级和小时级数据
curl "http://localhost:3000/data/3.0/onecall?lat=40.7128&lon=-74.0060&exclude=minutely,hourly&units=imperial"
```

**响应示例**:

```json
{
  "success": true,
  "data": {
    "lat": 39.9042,
    "lon": 116.4074,
    "timezone": "Asia/Shanghai",
    "current": {
      "dt": 1673000000,
      "temp": 15.5,
      "humidity": 65,
      "weather": [
        {
          "main": "Clear",
          "description": "晴朗"
        }
      ]
    },
    "daily": [
      {
        "dt": 1673000000,
        "temp": {
          "min": 8.2,
          "max": 18.5
        }
      }
    ]
  },
  "source": "cache",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 服务状态监控

**请求地址**: `GET /health`

**响应示例**:

```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": "2024-01-01T12:00:00.000Z",
  "apiKeys": {
    "total": 4,
    "available": 3,
    "blocked": 1
  },
  "cache": {
    "keys": 1500,
    "hitRate": "85.2%"
  },
  "requests": {
    "total": 15000,
    "errors": 25,
    "cacheHits": 12750
  }
}
```

### API 使用统计

**请求地址**: `GET /stats`

**响应示例**:

```json
{
  "keys": [
    {
      "id": "key_1",
      "requests": 1500,
      "limit": 2000,
      "available": true,
      "resetTime": "2024-01-02T00:00:00.000Z"
    },
    {
      "id": "key_2", 
      "requests": 2000,
      "limit": 2000,
      "available": false,
      "resetTime": "2024-01-02T00:00:00.000Z"
    }
  ],
  "performance": {
    "totalRequests": 15000,
    "cacheHits": 12750,
    "errors": 25,
    "uptime": "4h 15m",
    "cacheHitRate": "85.0%",
    "errorRate": "0.17%"
  },
  "cache": {
    "totalKeys": 1500,
    "maxKeys": 10000,
    "ttl": "300s"
  }
}
```

## 🏗️ 项目结构

```
open-weather-router-api/
├── src/
│   ├── controllers/        # 控制器层
│   │   ├── WeatherService.js
│   │   └── ApiKeyManager.js
│   ├── routes/            # 路由层
│   │   ├── weather.js
│   │   ├── health.js
│   │   └── stats.js
│   ├── middlewares/       # 中间件
│   ├── utils/             # 工具函数
│   ├── config/            # 配置文件
│   └── app.js             # 应用入口
├── tests/                 # 测试文件
├── docs/                  # 文档
├── logs/                  # 日志文件
├── ecosystem.config.js    # PM2 配置
├── Dockerfile            # Docker 配置
├── .env.example          # 环境变量示例
├── package.json
└── README.md
```

## ⚙️ 高级配置

### API 密钥管理策略

支持多种负载均衡策略：

```javascript
// 轮询模式 (默认)
strategy: 'round-robin'

// 最少使用优先
strategy: 'least-used'

// 随机选择
strategy: 'random'
```

### 缓存配置

```bash
# 基础缓存配置
CACHE_TTL=300              # 缓存过期时间 (秒)
CACHE_MAX_KEYS=10000       # 最大缓存数量

# Redis 缓存 (可选)
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_password
```

### 监控和日志

```bash
# 日志配置
LOG_LEVEL=info             # 日志级别: error, warn, info, debug
LOG_FILE=./logs/app.log    # 日志文件路径

# 监控配置
ENABLE_METRICS=true        # 启用性能指标
METRICS_PORT=9090          # Prometheus 指标端口
```

## 📊 性能优化

### 缓存策略

- **L1 缓存**: 进程内存缓存 (5分钟 TTL)
- **L2 缓存**: Redis 集群缓存 (可选)
- **智能预热**: 热点数据预加载
- **缓存穿透保护**: 防止恶意请求

### 并发优化

- **连接池**: HTTP 连接复用
- **请求合并**: 相同请求去重
- **限流保护**: 防止服务过载
- **熔断机制**: 故障自动恢复

## 🔧 开发命令

```bash
# 开发环境
npm run dev              # 启动开发服务器 (nodemon)
npm run test             # 运行测试套件
npm run test:watch       # 监听模式测试
npm run lint             # 代码检查 (ESLint)
npm run format           # 代码格式化 (Prettier)

# 生产环境
npm run build            # 构建项目
npm start                # 启动生产服务器
npm run pm2:start        # PM2 集群部署
npm run pm2:stop         # 停止 PM2 服务
npm run pm2:restart      # 重启 PM2 服务
npm run pm2:logs         # 查看 PM2 日志
```

## 📈 部署指南

### PM2 集群部署

```bash
# 安装 PM2
npm install -g pm2

# 启动集群 (推荐)
npm run pm2:start

# 查看状态
pm2 status

# 查看日志
pm2 logs weather-api

# 监控面板
pm2 monitor
```

### Docker 部署

```bash
# 构建镜像
docker build -t weather-api .

# 运行容器
docker run -d \
  --name weather-api \
  -p 3000:3000 \
  -e OPENWEATHER_API_KEYS="key1,key2,key3" \
  weather-api

# 使用 docker-compose
docker-compose up -d
```

### Nginx 反向代理

```nginx
upstream weather_api {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;
    
    location /data/ {
        proxy_pass http://weather_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # 缓存设置
        proxy_cache_valid 200 5m;
        proxy_cache_use_stale error timeout updating;
    }
}
```

## 🛡️ 安全建议

- ✅ 使用 HTTPS 协议
- ✅ 设置 API 访问频率限制
- ✅ 定期轮换 API 密钥
- ✅ 启用请求日志审计
- ✅ 配置防火墙规则
- ✅ 使用环境变量存储敏感信息
- ✅ 定期更新依赖包

## 📊 性能基准

在 4核8GB 服务器上的性能表现：

| 指标 | 数值 |
|------|------|
| 最大 QPS | 25,000+ |
| 平均响应时间 | < 50ms (缓存命中) |
| 平均响应时间 | < 300ms (API 调用) |
| 缓存命中率 | > 80% |
| 内存使用 | < 2GB |
| CPU 使用率 | < 60% |

## 🔍 故障排查

### 常见问题

1. **API 密钥用完**
   ```bash
   # 检查密钥使用情况
   curl http://localhost:3000/stats
   ```

2. **缓存问题**
   ```bash
   # 清空缓存
   curl -X DELETE http://localhost:3000/data/3.0/cache
   ```

3. **服务状态检查**
   ```bash
   # 健康检查
   curl http://localhost:3000/health
   ```

### 监控指标

- **响应时间**: P50, P95, P99
- **错误率**: 5xx 错误百分比
- **缓存命中率**: 缓存效果评估
- **API 密钥使用率**: 避免超限

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🤝 贡献指南

1. Fork 本项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交变更 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📞 技术支持

- 📧 Email: support@example.com
- 💬 Issues: [GitHub Issues](https://github.com/your-repo/issues)
- 📖 文档: [在线文档](https://docs.example.com)
- 💡 讨论: [GitHub Discussions](https://github.com/your-repo/discussions)

---

⭐ 如果这个项目对您有帮助，请给个星标支持！