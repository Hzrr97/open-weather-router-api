'use strict';

const axios = require('axios');
const NodeCache = require('node-cache');
const ApiKeyManager = require('./ApiKeyManager');

class WeatherService {
  constructor() {
    // 检查是否启用缓存
    this.cacheEnabled = process.env.ENABLE_CACHE !== 'false'; // 默认启用
    
    // 初始化缓存，只有启用时才创建
    if (this.cacheEnabled) {
      this.cache = new NodeCache({
        stdTTL: parseInt(process.env.CACHE_TTL) || 300,
        maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 10000,
        checkperiod: 60,
        useClones: false // 性能优化：不复制对象
      });
      console.log(`💾 缓存已启用 - TTL: ${parseInt(process.env.CACHE_TTL) || 300}秒, 最大条目: ${parseInt(process.env.CACHE_MAX_KEYS) || 10000}`);
    } else {
      this.cache = null;
      console.log('🚫 缓存已禁用');
    }
    
    // 初始化API密钥管理器（基于Redis）
    this.apiKeyManager = new ApiKeyManager();
    this.initializationPromise = this.initialize(); // 保存初始化Promise
    
    // 初始化HTTP客户端
    this.httpClient = axios.create({
      timeout: parseInt(process.env.API_TIMEOUT) || 10000,
      headers: {
        'User-Agent': 'OpenWeather-Proxy/1.0',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate'
      },
      // 连接池配置
      maxRedirects: 3,
      // HTTP Agent配置用于连接复用
      httpAgent: new (require('http')).Agent({
        keepAlive: true,
        maxSockets: 100,
        maxFreeSockets: 10,
        timeout: 60000
      }),
      httpsAgent: new (require('https')).Agent({
        keepAlive: true,
        maxSockets: 100,
        maxFreeSockets: 10,
        timeout: 60000
      })
    });
    
    // 统计信息
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheWrites: 0,
      apiCalls: 0,
      errors: 0,
      startTime: Date.now(),
      responseTimeSum: 0,
      maxResponseTime: 0,
      minResponseTime: Infinity
    };

    // 请求去重Map - 防止相同请求并发
    this.pendingRequests = new Map();

    // 错误重试配置
    this.retryConfig = {
      count: parseInt(process.env.API_RETRY_COUNT) || 3,
      delay: parseInt(process.env.API_RETRY_DELAY) || 1000
    };

    // 记录启动模式
    console.log(`🚀 WeatherService启动 - 模式: Redis`);
  }

  /**
   * 异步初始化方法 - 等待Redis连接就绪
   */
  async initialize() {
    try {
      await this.apiKeyManager.redisReady;
      console.log('🎯 WeatherService初始化完成 - Redis已就绪');
      return true;
    } catch (error) {
      console.error('❌ WeatherService初始化失败:', error.message);
      throw error;
    }
  }

  /**
   * 确保服务已初始化
   */
  async ensureInitialized() {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * 获取天气数据 - 主要接口
   */
  async getWeatherData(params) {
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    try {
      // 确保服务已初始化
      await this.ensureInitialized();
      
      // 生成缓存键
      const cacheKey = this.generateCacheKey(params);
      
      // 检查缓存（仅在启用时）
      const cachedData = this.cacheEnabled ? this.cache?.get(cacheKey) : null;
      if (cachedData) {
        this.stats.cacheHits++;
        this.updateResponseTime(startTime);
        
        // 直接返回缓存的原始数据
        return cachedData;
      }
      
      // 检查是否有相同的请求正在处理
      if (this.pendingRequests.has(cacheKey)) {
        // 等待已有的请求完成
        return await this.pendingRequests.get(cacheKey);
      }
      
      // 创建新的请求Promise
      const requestPromise = this.fetchWeatherFromAPI(params, cacheKey);
      this.pendingRequests.set(cacheKey, requestPromise);
      
      try {
        const result = await requestPromise;
        this.updateResponseTime(startTime);
        return result;
      } finally {
        // 清理pending请求
        this.pendingRequests.delete(cacheKey);
      }
      
    } catch (error) {
      this.stats.errors++;
      this.updateResponseTime(startTime);
      throw error;
    }
  }

  /**
   * 从API获取天气数据 - 支持集群模式和密钥更换
   */
  async fetchWeatherFromAPI(params, cacheKey) {
    let lastError = null;
    
    // 重试机制
    for (let attempt = 1; attempt <= this.retryConfig.count; attempt++) {
      try {
        // 获取所有可用的API密钥列表（按优先级排序）
        const availableKeys = await this.apiKeyManager.getAllAvailableKeys();
        if (availableKeys.length === 0) {
          throw new Error('所有API密钥都已达到使用限制或错误次数限制');
        }
        
        // 尝试每个可用的密钥
        for (let keyIndex = 0; keyIndex < availableKeys.length; keyIndex++) {
          const apiKey = availableKeys[keyIndex];
          
          try {
            // 构建请求URL
            const url = this.buildApiUrl(params, apiKey.key);
            
            // 发送请求
            const response = await this.httpClient.get(url);
            
            // 记录API密钥使用（支持集群模式）
            await this.apiKeyManager.recordUsage(apiKey.id);
            this.stats.apiCalls++;
            
            // 缓存结果（仅在启用时）
            if (this.cacheEnabled && this.cache) {
              this.cache.set(cacheKey, response.data);
              this.stats.cacheWrites++;
            }
            
            // 成功！直接返回API的原始响应数据
            return response.data;
            
          } catch (error) {
            lastError = error;
            
            // 记录密钥错误
            await this.apiKeyManager.recordError(apiKey.id);
            
            console.warn(`🔄 API密钥 ${apiKey.id} 调用失败，尝试下一个密钥 (密钥 ${keyIndex + 1}/${availableKeys.length}, 重试 ${attempt}/${this.retryConfig.count}):`, {
              error: error.message,
              status: error.response?.status,
              keyId: apiKey.id,
              url: error.config?.url
            });
            
            // 如果不是最后一个密钥，继续尝试下一个
            if (keyIndex < availableKeys.length - 1) {
              continue;
            }
            
            // 所有密钥都失败了，跳出密钥循环
            break;
          }
        }
        
        // 如果所有密钥都失败了，记录详细错误
        console.error(`❌ 所有可用密钥都已失败 (重试 ${attempt}/${this.retryConfig.count})`);
        
      } catch (error) {
        lastError = error;
        console.error(`获取可用密钥失败 (重试 ${attempt}/${this.retryConfig.count}):`, error.message);
      }
      
      // 如果不是最后一次重试，等待重试
      if (attempt < this.retryConfig.count) {
        const delay = this.retryConfig.delay * attempt; // 指数退避
        console.log(`⏰ 等待 ${delay}ms 后进行第 ${attempt + 1} 次重试...`);
        await this.sleep(delay);
      }
    }
    
    // 所有重试和密钥都失败了 - 直接抛出原始错误
    throw lastError;
  }

  /**
   * 生成缓存键
   */
  generateCacheKey(params) {
    // 使用所有传入的参数来生成缓存键
    const keyParts = [`lat:${params.lat}`, `lon:${params.lon}`];
    
    if (params.exclude) keyParts.push(`exclude:${params.exclude}`);
    if (params.units) keyParts.push(`units:${params.units}`);
    if (params.lang) keyParts.push(`lang:${params.lang}`);
    
    return `weather:${keyParts.join(':')}`;
  }

  /**
   * 构建API请求URL
   */
  buildApiUrl(params, apiKey) {
    const baseUrl = 'https://api.openweathermap.org/data/3.0/onecall';
    const urlParams = new URLSearchParams({
      lat: params.lat,
      lon: params.lon,
      appid: apiKey
    });

    // 添加可选参数
    if (params.exclude) urlParams.append('exclude', params.exclude);
    if (params.units) urlParams.append('units', params.units);
    if (params.lang) urlParams.append('lang', params.lang);

    return `${baseUrl}?${urlParams.toString()}`;
  }

  /**
   * 更新响应时间统计
   */
  updateResponseTime(startTime) {
    const responseTime = Date.now() - startTime;
    this.stats.responseTimeSum += responseTime;
    this.stats.maxResponseTime = Math.max(this.stats.maxResponseTime, responseTime);
    this.stats.minResponseTime = Math.min(this.stats.minResponseTime, responseTime);
  }

  /**
   * 睡眠函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取服务统计信息 - 支持集群模式
   */
  async getStats() {
    // 确保服务已初始化
    await this.ensureInitialized();
    
    const uptime = Date.now() - this.stats.startTime;
    const cacheKeys = this.cache?.keys().length || 0;
    const cacheHitRate = this.stats.totalRequests > 0 
      ? ((this.stats.cacheHits / this.stats.totalRequests) * 100).toFixed(1)
      : '0.0';
    
    const avgResponseTime = this.stats.totalRequests > 0
      ? Math.round(this.stats.responseTimeSum / this.stats.totalRequests)
      : 0;

    // 异步获取API密钥统计
    const apiKeyStats = await this.apiKeyManager.getStats();
    const remainingQuota = await this.apiKeyManager.getRemainingQuota();

    return {
      ...this.stats,
      uptime: Math.floor(uptime / 1000),
      cacheKeys,
      cacheHitRate: `${cacheHitRate}%`,
      avgResponseTime: `${avgResponseTime}ms`,
      maxResponseTime: `${this.stats.maxResponseTime}ms`,
      minResponseTime: this.stats.minResponseTime === Infinity ? '0ms' : `${this.stats.minResponseTime}ms`,
      apiKeys: apiKeyStats,
      pendingRequests: this.pendingRequests.size,
      remainingQuota: remainingQuota,
      mode: 'redis',
      cacheEnabled: this.cacheEnabled,
      clusterStats: {
        redisConnected: this.apiKeyManager.redisConnected || false,
        storageMode: apiKeyStats.mode || 'redis'
      }
    };
  }

  /**
   * 获取详细统计信息 - 支持集群模式
   */
  async getDetailedStats() {
    // 确保服务已初始化
    await this.ensureInitialized();
    
    const basicStats = await this.getStats();
    const apiKeyStats = await this.apiKeyManager.getDetailedStats();
    
    return {
      ...basicStats,
      apiKeyDetails: apiKeyStats,
      cache: {
        size: this.cache?.keys().length || 0,
        maxSize: this.cache?.options.maxKeys || 0,
        ttl: this.cache?.options.stdTTL || 0,
        hits: this.stats.cacheHits,
        writes: this.stats.cacheWrites,
        hitRate: basicStats.cacheHitRate
      },
      performance: {
        totalRequests: this.stats.totalRequests,
        apiCalls: this.stats.apiCalls,
        errors: this.stats.errors,
        errorRate: this.stats.totalRequests > 0 
          ? `${((this.stats.errors / this.stats.totalRequests) * 100).toFixed(2)}%`
          : '0.00%',
        avgResponseTime: basicStats.avgResponseTime,
        maxResponseTime: basicStats.maxResponseTime,
        minResponseTime: basicStats.minResponseTime
      },
      cluster: {
        mode: 'redis',
        redisConnected: this.apiKeyManager.redisConnected || false,
        storageMode: apiKeyStats.mode || 'redis',
        processId: process.pid,
        instanceId: process.env.INSTANCE_ID || 'unknown'
      }
    };
  }

  /**
   * 清空缓存
   */
  clearCache() {
    if (!this.cacheEnabled) {
      return { 
        success: false, 
        message: '缓存未启用，无需清空',
        cacheEnabled: false
      };
    }
    
    const clearedKeys = this.cache?.keys().length || 0;
    this.cache?.flushAll();
    return { 
      success: true, 
      message: `已清空 ${clearedKeys} 个缓存项`,
      clearedItems: clearedKeys,
      cacheEnabled: true
    };
  }

  /**
   * 缓存预热
   */
  async warmupCache(locations = []) {
    if (!this.cacheEnabled) {
      return {
        success: false,
        message: '缓存未启用，无法预热',
        cacheEnabled: false
      };
    }

    if (!Array.isArray(locations) || locations.length === 0) {
      throw new Error('locations 必须是非空数组');
    }

    const results = [];
    const maxConcurrent = 5; // 限制并发数

    for (let i = 0; i < locations.length; i += maxConcurrent) {
      const batch = locations.slice(i, i + maxConcurrent);
      const promises = batch.map(async (location) => {
        try {
          await this.getWeatherData(location);
          return { location, success: true };
        } catch (error) {
          return { location, success: false, error: error.message };
        }
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }

    return {
      success: true,
      message: `缓存预热完成，处理了 ${results.length} 个位置`,
      results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      },
      cacheEnabled: true
    };
  }

  /**
   * 健康检查 - 支持集群模式
   */
  async healthCheck() {
    try {
      // 确保服务已初始化
      await this.ensureInitialized();
      
      // 检查API密钥可用性（异步）
      const apiKeyHealth = await this.apiKeyManager.healthCheck();
      const availableKeys = apiKeyHealth.availableKeys || 0;
      
      if (availableKeys === 0) {
        throw new Error('没有可用的API密钥');
      }

      // 检查缓存状态
      let cacheHealth = true;
      if (this.cacheEnabled && this.cache) {
        cacheHealth = this.cache.keys().length < this.cache.options.maxKeys;
        if (!cacheHealth) {
          console.warn('缓存已满，可能影响性能');
        }
      }

      return {
        status: 'healthy',
        checks: {
          apiKeys: availableKeys > 0,
          cache: this.cacheEnabled ? cacheHealth : 'disabled',
          pendingRequests: this.pendingRequests.size < 1000,
          redis: this.apiKeyManager.redisConnected || false
        },
        availableKeys,
        cacheUsage: this.cacheEnabled 
          ? `${this.cache?.keys().length || 0}/${this.cache?.options.maxKeys || 0}`
          : 'disabled',
        cacheEnabled: this.cacheEnabled,
        uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
        mode: 'redis',
        cluster: {
          redisConnected: this.apiKeyManager.redisConnected || false,
          storageMode: 'redis'
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        mode: 'redis'
      };
    }
  }

  /**
   * 析构函数 - 清理资源
   */
  destroy() {
    // 清理API密钥管理器
    if (this.apiKeyManager) {
      this.apiKeyManager.destroy();
    }
    
    // 清理缓存
    if (this.cache) {
      this.cache.close();
    }
    
    // 清理pending请求
    this.pendingRequests.clear();
  }
}

module.exports = WeatherService; 