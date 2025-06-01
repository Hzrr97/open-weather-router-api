# 集群模式下的API密钥管理策略

## 问题分析

### 单进程模式
```
进程1: ApiKeyManager (内存统计)
  ├── key1: 500次/天
  ├── key2: 300次/天
  └── key3: 800次/天
```

### 集群模式 (问题场景)
```
进程1: ApiKeyManager     进程2: ApiKeyManager
├── key1: 500次/天       ├── key1: 400次/天
├── key2: 300次/天   ×   ├── key2: 600次/天  
└── key3: 800次/天       └── key3: 200次/天

实际总计: key1=900次, key2=900次, key3=1000次
各进程认为: 都在限制内，但实际可能超限！
```

## 解决方案

### 方案1: 共享内存 (Redis) - 推荐
```javascript
// 优点: 实时同步，精确统计
// 缺点: 增加Redis依赖

class ClusterApiKeyManager {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL);
  }
  
  async recordUsage(keyId) {
    const today = this.getTodayString();
    const usageKey = `api_usage:${keyId}:${today}`;
    const count = await this.redis.incr(usageKey);
    await this.redis.expire(usageKey, 86400); // 24小时过期
    return count;
  }
}
```

### 方案2: 进程间通信 (IPC) - 简单
```javascript
// 优点: 无外部依赖
// 缺点: 复杂度高，重启丢失数据

// 主进程维护统计
if (cluster.isMaster) {
  const apiUsage = new Map();
  cluster.on('message', (worker, message) => {
    if (message.type === 'API_USAGE') {
      // 更新统计并广播给所有进程
    }
  });
}
```

### 方案3: 文件锁 - 不推荐
```javascript
// 优点: 无外部依赖
// 缺点: 性能差，Windows兼容性问题
```

### 方案4: 数据库 - 重量级
```javascript
// 优点: 持久化，集群友好
// 缺点: 增加数据库依赖，性能开销
```

## 推荐实现: Redis + 降级策略

### 架构设计
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   进程1     │    │   进程2     │    │   进程3     │
│  API请求    │    │  API请求    │    │  API请求    │
└─────┬───────┘    └─────┬───────┘    └─────┬───────┘
      │                  │                  │
      └──────────────────┼──────────────────┘
                         │
                ┌────────▼────────┐
                │   Redis Server  │
                │  (统计中心)     │
                │  ┌─────────────┐│
                │  │key1: 1250次││
                │  │key2: 800次 ││
                │  │key3: 950次 ││
                │  └─────────────┘│
                └─────────────────┘
``` 