'use strict';

const WeatherService = require('../services/WeatherService');

// 全局WeatherService实例引用
let weatherServiceInstance = null;

async function healthRoutes(fastify, options) {
  // 获取WeatherService实例
  const getWeatherService = () => {
    if (!weatherServiceInstance) {
      weatherServiceInstance = new WeatherService();
    }
    return weatherServiceInstance;
  };

  // 基础健康检查
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      summary: '基础健康检查',
      description: '检查服务整体健康状态'
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const stats = await weatherService.getStats(); // 异步
      const healthCheck = await weatherService.healthCheck(); // 异步
      
      // 系统信息
      const memUsage = process.memoryUsage();
      const systemInfo = {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        memory: {
          rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
          external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
        },
        loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0]
      };

      // 判断整体健康状态
      const isHealthy = healthCheck.status === 'healthy' && 
                       (stats.apiKeys?.available || 0) > 0 &&
                       stats.errors < (stats.totalRequests || 1) * 0.1; // 错误率小于10%

      if (!isHealthy) {
        return reply.status(503).send({
          status: 'unhealthy',
          error: healthCheck.error || '服务状态异常',
          timestamp: new Date().toISOString(),
          details: healthCheck
        });
      }

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: stats.uptime || 0,
        version: '1.0.0',
        apiKeys: {
          total: stats.apiKeys?.total || 0,
          available: stats.apiKeys?.available || 0,
          blocked: stats.apiKeys?.blocked || 0,
          remainingQuota: stats.remainingQuota || 0
        },
        cache: {
          enabled: stats.cacheEnabled || false,
          keys: stats.cacheKeys || 0,
          hitRate: stats.cacheHitRate || '0.0%',
          maxSize: parseInt(process.env.CACHE_MAX_KEYS) || 10000
        },
        requests: {
          total: stats.totalRequests || 0,
          errors: stats.errors || 0,
          errorRate: (stats.totalRequests || 0) > 0 
            ? `${(((stats.errors || 0) / stats.totalRequests) * 100).toFixed(2)}%`
            : '0.00%',
          avgResponseTime: stats.avgResponseTime || '0ms',
          pendingRequests: stats.pendingRequests || 0
        },
        system: systemInfo,
        cluster: stats.mode === 'cluster' ? {
          mode: 'cluster',
          redisConnected: stats.clusterStats?.redisConnected || false,
          storageMode: stats.clusterStats?.storageMode || 'unknown',
          processId: process.pid,
          instanceId: process.env.INSTANCE_ID || 'unknown'
        } : {
          mode: 'single',
          processId: process.pid
        }
      };
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Health check failed');
      
      return reply.status(503).send({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 详细健康检查
  fastify.get('/health/detailed', {
    schema: {
      tags: ['health'],
      summary: '详细健康检查',
      description: '获取详细的健康状态和系统检查结果'
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const detailedStats = await weatherService.getDetailedStats(); // 异步
      
      // 详细的健康检查项目
      const checks = {
        database: { status: 'not_required', message: '本服务不需要数据库' },
        cache: {
          status: detailedStats.cacheKeys < detailedStats.cache.maxSize ? 'healthy' : 'warning',
          usage: `${detailedStats.cacheKeys}/${detailedStats.cache.maxSize}`,
          hitRate: detailedStats.cache.hitRate
        },
        apiKeys: {
          status: detailedStats.apiKeys.available > 0 ? 'healthy' : 'critical',
          available: detailedStats.apiKeys.available,
          total: detailedStats.apiKeys.total,
          usage: detailedStats.apiKeyDetails.usage.map(key => ({
            id: key.id,
            usagePercentage: key.usagePercentage,
            available: key.available
          }))
        },
        performance: {
          status: detailedStats.performance.errorRate.includes('0.') ? 'healthy' : 'warning',
          errorRate: detailedStats.performance.errorRate,
          avgResponseTime: detailedStats.performance.avgResponseTime,
          totalRequests: detailedStats.performance.totalRequests
        },
        memory: {
          status: process.memoryUsage().heapUsed < process.memoryUsage().heapTotal * 0.8 ? 'healthy' : 'warning',
          usage: process.memoryUsage()
        },
        network: {
          status: 'unknown',
          message: '网络连接状态需要实际测试'
        },
        cluster: detailedStats.cluster.mode === 'cluster' ? {
          status: detailedStats.cluster.redisConnected ? 'healthy' : 'warning',
          redisConnected: detailedStats.cluster.redisConnected,
          storageMode: detailedStats.cluster.storageMode
        } : {
          status: 'not_applicable',
          message: '单进程模式'
        }
      };

      // 环境信息
      const environment = {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 3000,
        clusterMode: detailedStats.cluster.mode || 'single',
        cacheConfig: {
          ttl: process.env.CACHE_TTL || 300,
          maxKeys: process.env.CACHE_MAX_KEYS || 10000
        },
        rateLimitConfig: {
          max: process.env.RATE_LIMIT_MAX || 100,
          window: process.env.RATE_LIMIT_WINDOW || 60000
        },
        apiConfig: {
          timeout: process.env.API_TIMEOUT || 10000,
          retryCount: process.env.API_RETRY_COUNT || 3,
          retryDelay: process.env.API_RETRY_DELAY || 1000
        }
      };

      // 确定整体状态
      const criticalChecks = Object.values(checks).filter(check => check.status === 'critical');
      const warningChecks = Object.values(checks).filter(check => check.status === 'warning');
      
      let overallStatus = 'healthy';
      if (criticalChecks.length > 0) {
        overallStatus = 'critical';
      } else if (warningChecks.length > 0) {
        overallStatus = 'warning';
      }

      return {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks,
        stats: detailedStats,
        environment,
        cluster: detailedStats.cluster
      };
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Detailed health check failed');
      
      return reply.status(500).send({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 就绪检查 (Readiness Probe)
  fastify.get('/ready', {
    schema: {
      tags: ['health'],
      summary: '就绪检查',
      description: '检查服务是否准备好接受请求'
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const stats = weatherService.getStats();
      
      // 检查服务是否准备好接受请求
      const isReady = stats.apiKeys.available > 0;
      
      if (!isReady) {
        return reply.status(503).send({
          ready: false,
          error: '没有可用的API密钥',
          timestamp: new Date().toISOString()
        });
      }

      return {
        ready: true,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return reply.status(503).send({
        ready: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 存活检查 (Liveness Probe)
  fastify.get('/live', {
    schema: {
      tags: ['health'],
      summary: '存活检查',
      description: '检查服务进程是否正在运行'
    }
  }, async (request, reply) => {
    // 简单的存活检查，只要进程在运行就返回true
    const uptime = process.uptime();
    
    return {
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime)
    };
  });

  // 启动时间信息
  fastify.get('/uptime', {
    schema: {
      tags: ['health'],
      summary: '运行时间信息',
      description: '获取服务运行时间和启动信息'
    }
  }, async (request, reply) => {
    const processUptime = process.uptime();
    const systemUptime = require('os').uptime();
    const startTime = new Date(Date.now() - processUptime * 1000);
    
    // 格式化运行时间
    const formatUptime = (seconds) => {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      
      return `${days}d ${hours}h ${minutes}m ${secs}s`;
    };

    return {
      uptime: formatUptime(processUptime),
      startTime: startTime.toISOString(),
      processUptime: Math.floor(processUptime),
      systemUptime: Math.floor(systemUptime)
    };
  });

  // 版本信息
  fastify.get('/version', {
    schema: {
      tags: ['health'],
      summary: '版本信息',
      description: '获取应用版本和依赖信息'
    }
  }, async (request, reply) => {
    const packageJson = require('../../package.json');
    
    return {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      nodeVersion: process.version,
      dependencies: {
        fastify: packageJson.dependencies.fastify,
        axios: packageJson.dependencies.axios,
        'node-cache': packageJson.dependencies['node-cache']
      }
    };
  });

  // 日志管理接口
  fastify.get('/logs/stats', {
    schema: {
      tags: ['health'],
      summary: '日志统计信息',
      description: '获取日志文件统计信息和状态'
    }
  }, async (request, reply) => {
    try {
      const logManager = require('../utils/logManager');
      const stats = logManager.getLogStats();
      
      return {
        success: true,
        timestamp: new Date().toISOString(),
        logStats: stats
      };
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Failed to get log stats');
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 手动清理日志
  fastify.post('/logs/cleanup', {
    schema: {
      tags: ['health'],
      summary: '手动清理过期日志',
      description: '立即清理超过保留期限的日志文件'
    }
  }, async (request, reply) => {
    try {
      const logManager = require('../utils/logManager');
      logManager.manualCleanup();
      
      return {
        success: true,
        message: '日志清理已触发',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Failed to cleanup logs');
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 手动轮转日志
  fastify.post('/logs/rotate', {
    schema: {
      tags: ['health'],
      summary: '手动轮转日志',
      description: '立即检查并轮转日志文件'
    }
  }, async (request, reply) => {
    try {
      const logManager = require('../utils/logManager');
      logManager.manualRotation();
      
      return {
        success: true,
        message: '日志轮转已触发',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Failed to rotate logs');
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 钩子：记录健康检查日志
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/health') || request.url.startsWith('/ready') || request.url.startsWith('/live')) {
      // 健康检查请求不记录详细日志，避免日志污染
      request.log.level = 'silent';
    }
  });
}

module.exports = healthRoutes; 