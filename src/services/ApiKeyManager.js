'use strict';

const Redis = require('ioredis');

class ApiKeyManager {
  constructor() {
    this.keys = this.loadApiKeys();
    this.dailyLimit = parseInt(process.env.API_DAILY_LIMIT) || 2000; // 可配置每日限制
    this.currentIndex = 0; // 轮询索引
    
    // 初始化Redis连接 - 改为同步等待
    this.redis = null;
    this.redisConnected = false;
    this.redisReady = this.initRedis(); // 保存Promise以便外部等待
    
    // 定时清理过期数据
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldUsage();
    }, 60 * 60 * 1000); // 每小时清理一次
    
    // 记录配置信息
    console.log(`🔧 API密钥管理器启动 - 每日限制: ${this.dailyLimit} 次/密钥`);
    console.log(`📦 存储模式: Redis (${process.env.REDIS_URL || 'redis://localhost:6379'})`);
  }

  /**
   * 初始化Redis连接 - 返回Promise
   */
  async initRedis() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const redisOptions = {
        retryDelayOnFailover: 100,
        enableReadyCheck: true, // 改为true，确保连接就绪检查
        maxRetriesPerRequest: 3,
        lazyConnect: false, // 改为false，立即连接
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB) || 0,
        keyPrefix: 'weather_api:',
        connectTimeout: 5000, // 5秒连接超时
        commandTimeout: 3000  // 3秒命令超时
      };

      this.redis = new Redis(redisUrl, redisOptions);
      
      // 返回连接Promise
      return new Promise((resolve, reject) => {
        this.redis.on('connect', () => {
          console.log('✅ Redis连接成功');
          this.redisConnected = true;
          resolve();
        });
        
        this.redis.on('error', (err) => {
          console.error('❌ Redis连接错误:', err.message);
          this.redisConnected = false;
          if (!this.redisConnected) {
            reject(err);
          }
        });
        
        this.redis.on('close', () => {
          console.log('⚠️ Redis连接已关闭');
          this.redisConnected = false;
        });

        // 设置超时
        setTimeout(() => {
          if (!this.redisConnected) {
            reject(new Error('Redis连接超时'));
          }
        }, 6000);
      });
      
    } catch (error) {
      console.error('❌ Redis初始化失败:', error.message);
      this.redisConnected = false;
      throw error;
    }
  }

  /**
   * 加载API密钥
   */
  loadApiKeys() {
    const keysString = process.env.OPENWEATHER_API_KEYS;
    if (!keysString) {
      throw new Error('未配置OPENWEATHER_API_KEYS环境变量');
    }

    const keyArray = keysString.split(',').map(key => key.trim()).filter(key => key);
    if (keyArray.length === 0) {
      throw new Error('至少需要配置一个有效的API密钥');
    }

    return keyArray.map((key, index) => ({
      id: `key_${index + 1}`,
      key: key,
      dailyLimit: this.dailyLimit,
      priority: index // 优先级，索引越小优先级越高
    }));
  }

  /**
   * 获取可用的API密钥 - 使用最少使用优先策略
   */
  async getAvailableKey() {
    if (!this.redisConnected) {
      throw new Error('Redis连接不可用，无法获取API密钥');
    }

    const today = this.getTodayString();
    
    // 查找使用次数最少的可用密钥
    let selectedKey = null;
    let minUsage = Infinity;

    for (const keyInfo of this.keys) {
      const usageKey = `usage:${keyInfo.id}:${today}`;
      const errorKey = `errors:${keyInfo.id}:${today}`;
      try {
        const currentUsage = await this.redis.get(usageKey) || 0;
        const usage = parseInt(currentUsage);
        
        // 检查错误次数是否超过限制
        const errorCount = await this.redis.get(errorKey) || 0;
        const errors = parseInt(errorCount);
        
        // 如果错误次数达到3次，则跳过此密钥
        if (errors >= 3) {
          continue;
        }
        
        // 检查是否可用且使用次数最少
        if (usage < this.dailyLimit) {
          if (usage < minUsage || 
             (usage === minUsage && keyInfo.priority < (selectedKey?.priority || Infinity))) {
            selectedKey = keyInfo;
            minUsage = usage;
          }
        }
      } catch (error) {
        console.error(`获取密钥 ${keyInfo.id} 使用情况失败:`, error.message);
        // Redis出错时跳过这个key
        continue;
      }
    }

    if (!selectedKey) {
      throw new Error('所有API密钥都已达到每日使用限制或错误次数限制，请明天再试');
    }

    return selectedKey;
  }

  /**
   * 轮询获取密钥 (备用策略)
   */
  async getKeyByRoundRobin() {
    if (!this.redisConnected) {
      throw new Error('Redis连接不可用，无法获取API密钥');
    }

    const today = this.getTodayString();
    let attempts = 0;
    
    while (attempts < this.keys.length) {
      const keyInfo = this.keys[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      
      const usageKey = `usage:${keyInfo.id}:${today}`;
      try {
        const currentUsage = await this.redis.get(usageKey) || 0;
        const usage = parseInt(currentUsage);
        
        if (usage < this.dailyLimit) {
          return keyInfo;
        }
      } catch (error) {
        console.error(`检查密钥 ${keyInfo.id} 失败:`, error.message);
      }
      
      attempts++;
    }
    
    throw new Error('所有API密钥都已达到使用限制');
  }

  /**
   * 记录API密钥使用
   */
  async recordUsage(keyId) {
    if (!this.redisConnected) {
      console.error('Redis连接不可用，无法记录API密钥使用');
      return;
    }

    const today = this.getTodayString();
    const usageKey = `usage:${keyId}:${today}`;
    const timeKey = `times:${keyId}:${today}`;
    
    try {
      // 原子性增加使用计数
      await this.redis.incr(usageKey);
      
      // 设置过期时间为明天结束 (48小时后过期，确保跨时区安全)
      await this.redis.expire(usageKey, 48 * 60 * 60);
      
      // 记录使用时间用于统计
      const currentTime = Date.now();
      await this.redis.lpush(timeKey, currentTime);
      await this.redis.expire(timeKey, 48 * 60 * 60);
      
    } catch (error) {
      console.error(`记录API密钥 ${keyId} 使用失败:`, error.message);
    }
  }

  /**
   * 记录API密钥错误
   */
  async recordError(keyId) {
    if (!this.redisConnected) {
      console.error('Redis连接不可用，无法记录API密钥错误');
      return;
    }

    const today = this.getTodayString();
    const errorKey = `errors:${keyId}:${today}`;
    
    try {
      // 原子性增加错误计数
      const errorCount = await this.redis.incr(errorKey);
      
      // 设置过期时间为明天结束 (48小时后过期，确保跨时区安全)
      await this.redis.expire(errorKey, 48 * 60 * 60);
      
      console.warn(`🚨 API密钥 ${keyId} 错误计数: ${errorCount}/3`);
      
      // 如果错误次数达到3次，记录禁用状态
      if (errorCount >= 3) {
        console.error(`❌ API密钥 ${keyId} 当天错误次数达到限制，已设置为不可用`);
      }
      
      return errorCount;
    } catch (error) {
      console.error(`记录API密钥 ${keyId} 错误失败:`, error.message);
    }
  }

  /**
   * 获取密钥错误次数
   */
  async getKeyErrorCount(keyId) {
    if (!this.redisConnected) {
      return 0;
    }

    const today = this.getTodayString();
    const errorKey = `errors:${keyId}:${today}`;
    
    try {
      const errorCount = await this.redis.get(errorKey) || 0;
      return parseInt(errorCount);
    } catch (error) {
      console.error(`获取密钥 ${keyId} 错误次数失败:`, error.message);
      return 0;
    }
  }

  /**
   * 检查密钥是否可用（包括错误次数检查）
   */
  async isKeyAvailable(keyId) {
    if (!this.redisConnected) {
      return false;
    }

    const today = this.getTodayString();
    const usageKey = `usage:${keyId}:${today}`;
    const errorKey = `errors:${keyId}:${today}`;
    
    try {
      const currentUsage = await this.redis.get(usageKey) || 0;
      const errorCount = await this.redis.get(errorKey) || 0;
      
      const usage = parseInt(currentUsage);
      const errors = parseInt(errorCount);
      
      // 检查使用次数和错误次数
      return usage < this.dailyLimit && errors < 3;
    } catch (error) {
      console.error(`检查密钥 ${keyId} 可用性失败:`, error.message);
      return false;
    }
  }

  /**
   * 获取密钥使用情况
   */
  async getKeyUsage(keyId) {
    if (!this.redisConnected) {
      return 0;
    }

    const today = this.getTodayString();
    const usageKey = `usage:${keyId}:${today}`;
    
    try {
      const currentUsage = await this.redis.get(usageKey) || 0;
      return parseInt(currentUsage);
    } catch (error) {
      console.error(`获取密钥 ${keyId} 使用情况失败:`, error.message);
      return 0;
    }
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    const today = this.getTodayString();
    const stats = {
      total: this.keys.length,
      available: 0,
      blocked: 0,
      errorBlocked: 0,
      usage: [],
      totalRequestsToday: 0,
      totalErrorsToday: 0,
      mode: 'redis'
    };

    if (!this.redisConnected) {
      console.warn('Redis连接不可用，返回默认统计信息');
      return {
        ...stats,
        error: 'Redis连接不可用'
      };
    }

    for (const keyInfo of this.keys) {
      const usageKey = `usage:${keyInfo.id}:${today}`;
      const errorKey = `errors:${keyInfo.id}:${today}`;
      let currentUsage = 0;
      let currentErrors = 0;
      
      try {
        const usage = await this.redis.get(usageKey);
        currentUsage = parseInt(usage) || 0;
        
        const errors = await this.redis.get(errorKey);
        currentErrors = parseInt(errors) || 0;
      } catch (error) {
        console.error(`获取密钥 ${keyInfo.id} 统计失败:`, error.message);
      }
      
      const isUsageAvailable = currentUsage < this.dailyLimit;
      const isErrorBlocked = currentErrors >= 3;
      const isAvailable = isUsageAvailable && !isErrorBlocked;
      const usagePercentage = Math.round((currentUsage / this.dailyLimit) * 100);

      if (isAvailable) {
        stats.available++;
      } else {
        stats.blocked++;
        if (isErrorBlocked) {
          stats.errorBlocked++;
        }
      }

      stats.totalRequestsToday += currentUsage;
      stats.totalErrorsToday += currentErrors;

      stats.usage.push({
        id: keyInfo.id,
        requests: currentUsage,
        limit: this.dailyLimit,
        errors: currentErrors,
        maxErrors: 3,
        available: isAvailable,
        blockedByUsage: !isUsageAvailable,
        blockedByErrors: isErrorBlocked,
        status: isErrorBlocked ? 'error_blocked' : (isUsageAvailable ? 'available' : 'usage_blocked'),
        usagePercentage: `${usagePercentage}%`,
        remainingRequests: Math.max(0, this.dailyLimit - currentUsage),
        resetTime: this.getNextResetTime(),
        priority: keyInfo.priority
      });
    }

    // 按优先级排序
    stats.usage.sort((a, b) => a.priority - b.priority);

    return stats;
  }

  /**
   * 获取详细的使用统计
   */
  async getDetailedStats() {
    const today = this.getTodayString();
    const stats = await this.getStats();
    
    if (!this.redisConnected) {
      return {
        ...stats,
        hourlyUsage: new Array(24).fill(0),
        averageRequestsPerKey: 0,
        peakHour: 0,
        lowHour: 0
      };
    }
    
    // 添加小时级别的使用统计
    const hourlyUsage = new Array(24).fill(0);
    
    for (const keyInfo of this.keys) {
      const timeKey = `times:${keyInfo.id}:${today}`;
      
      try {
        // 获取所有时间戳 (Redis list)
        const times = await this.redis.lrange(timeKey, 0, -1);
        
        times.forEach(timestamp => {
          const time = parseInt(timestamp);
          if (!isNaN(time)) {
            const hour = new Date(time).getHours();
            hourlyUsage[hour]++;
          }
        });
      } catch (error) {
        console.error(`获取密钥 ${keyInfo.id} 时间统计失败:`, error.message);
      }
    }

    return {
      ...stats,
      hourlyUsage,
      averageRequestsPerKey: Math.round(stats.totalRequestsToday / this.keys.length),
      peakHour: hourlyUsage.indexOf(Math.max(...hourlyUsage)),
      lowHour: hourlyUsage.indexOf(Math.min(...hourlyUsage))
    };
  }

  /**
   * 重置指定密钥的使用计数 (仅用于测试)
   */
  async resetKeyUsage(keyId) {
    if (!this.redisConnected) {
      console.warn('Redis连接不可用，无法重置密钥使用计数');
      return;
    }

    const today = this.getTodayString();
    const usageKey = `usage:${keyId}:${today}`;
    const timeKey = `times:${keyId}:${today}`;
    
    try {
      await this.redis.del(usageKey);
      await this.redis.del(timeKey);
    } catch (error) {
      console.error(`重置密钥 ${keyId} 使用计数失败:`, error.message);
    }
  }

  /**
   * 重置所有密钥的使用计数 (仅用于测试)
   */
  async resetAllUsage() {
    if (!this.redisConnected) {
      console.warn('Redis连接不可用，无法重置所有使用计数');
      return;
    }

    try {
      // 删除所有usage、times和errors相关的key
      const pattern1 = 'usage:*';
      const pattern2 = 'times:*';
      const pattern3 = 'errors:*';
      
      const usageKeys = await this.redis.keys(pattern1);
      const timeKeys = await this.redis.keys(pattern2);
      const errorKeys = await this.redis.keys(pattern3);
      
      const allKeys = [...usageKeys, ...timeKeys, ...errorKeys];
      if (allKeys.length > 0) {
        await this.redis.del(...allKeys);
        console.log(`已重置 ${allKeys.length} 个使用记录`);
      }
    } catch (error) {
      console.error('重置所有使用计数失败:', error.message);
    }
  }

  /**
   * 获取今天的日期字符串 (YYYY-MM-DD)
   */
  getTodayString() {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * 获取下次重置时间 (明天0点)
   */
  getNextResetTime() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.toISOString();
  }

  /**
   * 清理过期的使用记录
   */
  async cleanupOldUsage() {
    if (!this.redisConnected) {
      return;
    }

    try {
      const today = this.getTodayString();
      
      // 获取所有usage、times和errors keys
      const usageKeys = await this.redis.keys('usage:*');
      const timeKeys = await this.redis.keys('times:*');
      const errorKeys = await this.redis.keys('errors:*');
      
      const keysToDelete = [];
      
      // 检查usage keys
      for (const key of usageKeys) {
        if (!key.includes(today)) {
          keysToDelete.push(key);
        }
      }
      
      // 检查times keys
      for (const key of timeKeys) {
        if (!key.includes(today)) {
          keysToDelete.push(key);
        }
      }
      
      // 检查errors keys
      for (const key of errorKeys) {
        if (!key.includes(today)) {
          keysToDelete.push(key);
        }
      }

      if (keysToDelete.length > 0) {
        await this.redis.del(...keysToDelete);
        console.log(`清理了 ${keysToDelete.length} 条过期的使用记录`);
      }
    } catch (error) {
      console.error('清理过期记录失败:', error.message);
    }
  }

  /**
   * 获取密钥剩余配额
   */
  async getRemainingQuota() {
    if (!this.redisConnected) {
      console.warn('Redis连接不可用，无法获取剩余配额');
      return 0;
    }

    const today = this.getTodayString();
    let totalUsed = 0;

    for (const keyInfo of this.keys) {
      const usageKey = `usage:${keyInfo.id}:${today}`;
      try {
        const usage = await this.redis.get(usageKey);
        totalUsed += parseInt(usage) || 0;
      } catch (error) {
        console.error(`获取密钥 ${keyInfo.id} 使用量失败:`, error.message);
      }
    }

    const totalQuota = this.keys.length * this.dailyLimit;
    return Math.max(0, totalQuota - totalUsed);
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    if (!this.redisConnected) {
      return {
        status: 'unhealthy',
        error: 'Redis连接不可用',
        availableKeys: 0,
        totalKeys: this.keys.length
      };
    }

    const today = this.getTodayString();
    let availableKeys = 0;

    for (const keyInfo of this.keys) {
      const usageKey = `usage:${keyInfo.id}:${today}`;
      try {
        const usage = await this.redis.get(usageKey);
        const currentUsage = parseInt(usage) || 0;
        if (currentUsage < this.dailyLimit) {
          availableKeys++;
        }
      } catch (error) {
        console.error(`检查密钥 ${keyInfo.id} 健康状态失败:`, error.message);
      }
    }

    return {
      status: availableKeys > 0 ? 'healthy' : 'unhealthy',
      availableKeys,
      totalKeys: this.keys.length,
      redisConnected: this.redisConnected
    };
  }

  /**
   * 析构函数 - 清理定时器和Redis连接
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
      this.redisConnected = false;
      console.log('🔌 Redis连接已断开');
    }
  }

  /**
   * 获取所有可用的API密钥列表（按优先级排序）
   */
  async getAllAvailableKeys() {
    if (!this.redisConnected) {
      throw new Error('Redis连接不可用，无法获取API密钥');
    }

    const today = this.getTodayString();
    const availableKeys = [];

    for (const keyInfo of this.keys) {
      const usageKey = `usage:${keyInfo.id}:${today}`;
      const errorKey = `errors:${keyInfo.id}:${today}`;
      try {
        const currentUsage = await this.redis.get(usageKey) || 0;
        const usage = parseInt(currentUsage);
        
        // 检查错误次数是否超过限制
        const errorCount = await this.redis.get(errorKey) || 0;
        const errors = parseInt(errorCount);
        
        // 如果密钥可用，添加到列表中
        if (usage < this.dailyLimit && errors < 3) {
          availableKeys.push({
            ...keyInfo,
            currentUsage: usage,
            currentErrors: errors
          });
        }
      } catch (error) {
        console.error(`获取密钥 ${keyInfo.id} 使用情况失败:`, error.message);
        // Redis出错时跳过这个key
        continue;
      }
    }

    // 按优先级排序，然后按使用次数排序
    availableKeys.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.currentUsage - b.currentUsage;
    });

    return availableKeys;
  }
}

module.exports = ApiKeyManager; 