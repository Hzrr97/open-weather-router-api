# Redis Key 过期逻辑测试

## 问题说明

### ❌ 原有问题
```javascript
// 每次使用都设置24小时过期
multi.expire(usageKey, 86400); // 错误！
```

**问题**：
- 每次API调用都重置过期时间
- Key永远不会在0点清理
- 统计周期变成"最后使用后24小时"

### ✅ 修复后的逻辑
```javascript
// 只在key第一次创建时设置过期时间
if (!keyExists) {
  const secondsUntilMidnight = this.getSecondsUntilMidnight();
  multi.expire(usageKey, secondsUntilMidnight);
}
```

**优点**：
- Key准确在每天0点过期
- 每日统计周期准确
- 避免重复设置过期时间

## 测试场景

### 场景1: 一天内的多次调用
```bash
时间: 2024-01-15 10:00:00
第1次调用: 设置key过期时间为14小时后（明天0点）
第2次调用: 不设置过期时间（key已存在）
第3次调用: 不设置过期时间（key已存在）
...
时间: 2024-01-16 00:00:00 - key自动过期
```

### 场景2: 跨天调用
```bash
时间: 2024-01-15 23:59:50
调用: 设置key过期时间为10秒后（明天0点）

时间: 2024-01-16 00:00:00
key自动过期，统计清零

时间: 2024-01-16 00:00:10  
调用: 创建新key，设置过期时间为24小时后
```

## 验证方法

### 手动测试Redis Key过期
```bash
# 连接Redis
redis-cli

# 查看某个key的TTL
TTL api_usage:key_1:2024-01-15

# 查看所有API使用key
KEYS api_usage:*

# 查看key的过期时间
TTL api_usage:key_1:2024-01-15
```

### 代码测试
```javascript
// 测试getSecondsUntilMidnight函数
const manager = new ClusterApiKeyManager();

console.log('当前时间:', new Date());
console.log('到明天0点秒数:', manager.getSecondsUntilMidnight());

// 应该输出合理的秒数（0-86400之间）
```

## 时区处理

### 注意事项
- 使用本地时区计算0点
- 服务器时区设置要正确
- 建议使用UTC时间统一处理

### 改进建议（可选）
```javascript
// 使用UTC时间确保一致性
getSecondsUntilMidnightUTC() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return Math.floor((tomorrow - now) / 1000);
}
```

## 监控建议

### 日志监控
```bash
# 查看每日重置日志
grep "为API密钥.*设置每日统计" logs/app.log

# 查看API使用限制警告
grep "今日使用已达限制" logs/app.log
```

### Redis监控
```bash
# 监控Redis内存使用
redis-cli info memory

# 监控过期key清理
redis-cli info stats | grep expired
``` 