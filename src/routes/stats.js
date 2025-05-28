'use strict';

const WeatherService = require('../services/WeatherService');

// 全局WeatherService实例引用
let weatherServiceInstance = null;

async function statsRoutes(fastify, options) {
  // 获取WeatherService实例
  const getWeatherService = () => {
    if (!weatherServiceInstance) {
      weatherServiceInstance = new WeatherService();
    }
    return weatherServiceInstance;
  };

  // 基础统计信息
  fastify.get('/stats', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            timestamp: { type: 'string' },
            keys: { type: 'array' },
            performance: { type: 'object' },
            cache: { type: 'object' },
            system: { type: 'object' },
            cluster: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const stats = await weatherService.getStats();
      
      // 系统资源信息
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      return {
        success: true,
        timestamp: new Date().toISOString(),
        keys: stats.apiKeys?.usage || [],
        performance: {
          totalRequests: stats.totalRequests || 0,
          cacheHits: stats.cacheHits || 0,
          cacheWrites: stats.cacheWrites || 0,
          apiCalls: stats.apiCalls || 0,
          errors: stats.errors || 0,
          uptime: formatUptime(stats.uptime || 0),
          cacheHitRate: stats.cacheHitRate || '0.0%',
          errorRate: (stats.totalRequests || 0) > 0 
            ? `${(((stats.errors || 0) / stats.totalRequests) * 100).toFixed(2)}%`
            : '0.00%',
          avgResponseTime: stats.avgResponseTime || '0ms',
          maxResponseTime: stats.maxResponseTime || '0ms',
          minResponseTime: stats.minResponseTime || '0ms',
          pendingRequests: stats.pendingRequests || 0
        },
        cache: {
          totalKeys: stats.cacheKeys || 0,
          maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 10000,
          hitRate: stats.cacheHitRate || '0.0%',
          ttl: `${parseInt(process.env.CACHE_TTL) || 300}s`,
          usage: `${Math.round(((stats.cacheKeys || 0) / (parseInt(process.env.CACHE_MAX_KEYS) || 10000)) * 100)}%`,
          enabled: stats.cacheEnabled || false,
          status: stats.cacheEnabled ? 'active' : 'disabled'
        },
        system: {
          memory: {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            heapUsage: `${Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)}%`
          },
          cpu: {
            user: Math.round(cpuUsage.user / 1000),
            system: Math.round(cpuUsage.system / 1000)
          },
          uptime: formatUptime(process.uptime()),
          platform: process.platform,
          nodeVersion: process.version
        },
        cluster: stats.clusterStats ? {
          mode: stats.mode,
          redisConnected: stats.clusterStats.redisConnected,
          storageMode: stats.clusterStats.storageMode,
          processId: process.pid,
          instanceId: process.env.INSTANCE_ID || 'unknown'
        } : {
          mode: 'single',
          processId: process.pid
        }
      };
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Failed to get stats');
      
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 详细统计信息
  fastify.get('/stats/detailed', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            timestamp: { type: 'string' },
            overview: { type: 'object' },
            apiKeys: { type: 'object' },
            cache: { type: 'object' },
            performance: { type: 'object' },
            system: { type: 'object' },
            config: { type: 'object' },
            cluster: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const detailedStats = await weatherService.getDetailedStats();
      
      return {
        success: true,
        timestamp: new Date().toISOString(),
        overview: {
          status: 'running',
          uptime: formatUptime(detailedStats.uptime),
          version: '1.0.0',
          totalRequests: detailedStats.totalRequests,
          remainingQuota: detailedStats.remainingQuota || 0,
          mode: detailedStats.mode || 'single'
        },
        apiKeys: {
          summary: {
            total: detailedStats.apiKeys.total,
            available: detailedStats.apiKeys.available,
            blocked: detailedStats.apiKeys.blocked,
            totalRequestsToday: detailedStats.apiKeyDetails.totalRequestsToday || 0,
            averageRequestsPerKey: detailedStats.apiKeyDetails.averageRequestsPerKey || 0,
            mode: detailedStats.apiKeyDetails.mode || 'unknown'
          },
          usage: detailedStats.apiKeyDetails.usage || [],
          hourlyUsage: detailedStats.apiKeyDetails.hourlyUsage || new Array(24).fill(0),
          peakHour: detailedStats.apiKeyDetails.peakHour || 0,
          lowHour: detailedStats.apiKeyDetails.lowHour || 0
        },
        cache: detailedStats.cache,
        performance: {
          ...detailedStats.performance,
          requestDistribution: {
            cacheHits: detailedStats.cacheHits,
            apiCalls: detailedStats.apiCalls,
            errors: detailedStats.errors
          },
          responseTimeStats: {
            avg: detailedStats.avgResponseTime,
            max: detailedStats.maxResponseTime,
            min: detailedStats.minResponseTime
          }
        },
        system: getSystemStats(),
        config: getConfigInfo(),
        cluster: detailedStats.cluster || { mode: 'single' }
      };
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Failed to get detailed stats');
      
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // API密钥统计
  fastify.get('/stats/keys', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            timestamp: { type: 'string' },
            summary: { type: 'object' },
            keys: { type: 'array' },
            hourlyUsage: { type: 'array' },
            cluster: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const stats = await weatherService.getStats();
      const detailedStats = await weatherService.getDetailedStats();
      
      return {
        success: true,
        timestamp: new Date().toISOString(),
        summary: {
          total: stats.apiKeys?.total || 0,
          available: stats.apiKeys?.available || 0,
          blocked: stats.apiKeys?.blocked || 0,
          remainingQuota: stats.remainingQuota || 0,
          dailyLimit: parseInt(process.env.API_DAILY_LIMIT) || 2000,
          totalDailyLimit: (stats.apiKeys?.total || 0) * (parseInt(process.env.API_DAILY_LIMIT) || 2000),
          mode: stats.mode || 'single'
        },
        keys: stats.apiKeys?.usage || [],
        hourlyUsage: detailedStats.apiKeyDetails?.hourlyUsage || new Array(24).fill(0),
        statistics: {
          peakHour: detailedStats.apiKeyDetails?.peakHour || 0,
          lowHour: detailedStats.apiKeyDetails?.lowHour || 0,
          averageRequestsPerKey: detailedStats.apiKeyDetails?.averageRequestsPerKey || 0,
          totalRequestsToday: detailedStats.apiKeyDetails?.totalRequestsToday || 0
        },
        cluster: stats.clusterStats ? {
          redisConnected: stats.clusterStats.redisConnected,
          storageMode: stats.clusterStats.storageMode
        } : null
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 缓存统计
  fastify.get('/stats/cache', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            timestamp: { type: 'string' },
            cache: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const stats = await weatherService.getStats();
      
      return {
        success: true,
        timestamp: new Date().toISOString(),
        cache: {
          enabled: stats.cacheEnabled || false,
          status: stats.cacheEnabled ? 'active' : 'disabled',
          size: stats.cacheKeys,
          maxSize: parseInt(process.env.CACHE_MAX_KEYS) || 10000,
          usage: `${Math.round((stats.cacheKeys / (parseInt(process.env.CACHE_MAX_KEYS) || 10000)) * 100)}%`,
          hitRate: stats.cacheHitRate,
          hits: stats.cacheHits,
          writes: stats.cacheWrites,
          ttl: parseInt(process.env.CACHE_TTL) || 300,
          efficiency: {
            totalRequests: stats.totalRequests,
            cacheHits: stats.cacheHits,
            cacheMisses: stats.totalRequests - stats.cacheHits,
            hitRatio: stats.totalRequests > 0 
              ? (stats.cacheHits / stats.totalRequests).toFixed(3)
              : '0.000'
          }
        }
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 性能统计
  fastify.get('/stats/performance', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            timestamp: { type: 'string' },
            performance: { type: 'object' },
            trends: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const stats = await weatherService.getStats();
      
      // 计算QPS (基于运行时间)
      const qps = stats.uptime > 0 ? (stats.totalRequests / stats.uptime).toFixed(2) : '0.00';
      
      return {
        success: true,
        timestamp: new Date().toISOString(),
        performance: {
          totalRequests: stats.totalRequests,
          errors: stats.errors,
          errorRate: stats.totalRequests > 0 
            ? `${((stats.errors / stats.totalRequests) * 100).toFixed(2)}%`
            : '0.00%',
          qps: parseFloat(qps),
          responseTime: {
            average: stats.avgResponseTime,
            maximum: stats.maxResponseTime,
            minimum: stats.minResponseTime
          },
          throughput: {
            requestsPerSecond: parseFloat(qps),
            requestsPerMinute: parseFloat(qps) * 60,
            requestsPerHour: parseFloat(qps) * 3600
          },
          pendingRequests: stats.pendingRequests || 0,
          mode: stats.mode || 'single'
        },
        trends: {
          uptime: formatUptime(stats.uptime),
          cacheEfficiency: stats.cacheHitRate,
          apiCallsVsCacheHits: {
            apiCalls: stats.apiCalls || 0,
            cacheHits: stats.cacheHits,
            ratio: stats.cacheHits > 0 && stats.apiCalls > 0 
              ? (stats.cacheHits / (stats.apiCalls + stats.cacheHits)).toFixed(3)
              : '0.000'
          }
        }
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 重置统计信息 (管理功能)
  fastify.post('/stats/reset', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      
      // 这里应该实现重置统计的逻辑
      // 注意：这个功能需要谨慎使用，可能需要管理员权限
      
      request.log.warn('Statistics reset requested', {
        ip: request.ip,
        userAgent: request.headers['user-agent']
      });
      
      return {
        success: true,
        message: '统计信息重置功能暂未实现，请重启服务来重置统计',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 导出统计数据 (CSV格式)
  fastify.get('/stats/export', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'csv'] }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const weatherService = getWeatherService();
      const detailedStats = await weatherService.getDetailedStats();
      const format = request.query.format || 'json';
      
      if (format === 'csv') {
        // 生成CSV格式的统计数据
        const csvData = generateCSVStats(detailedStats);
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', 'attachment; filename="weather-api-stats.csv"');
        return csvData;
      } else {
        // 默认JSON格式
        reply.header('Content-Type', 'application/json');
        reply.header('Content-Disposition', 'attachment; filename="weather-api-stats.json"');
        return detailedStats;
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
}

// 辅助函数：格式化运行时间
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else {
    return `${minutes}m ${secs}s`;
  }
}

// 辅助函数：获取系统统计信息
function getSystemStats() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const loadAvg = process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0];
  
  return {
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024)
    },
    cpu: {
      user: Math.round(cpuUsage.user / 1000),
      system: Math.round(cpuUsage.system / 1000)
    },
    process: {
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version
    },
    system: {
      loadAverage: loadAvg,
      freeMemory: Math.round(require('os').freemem() / 1024 / 1024 / 1024),
      totalMemory: Math.round(require('os').totalmem() / 1024 / 1024 / 1024)
    }
  };
}

// 辅助函数：获取配置信息
function getConfigInfo() {
  return {
    server: {
      port: process.env.PORT || 3000,
      host: process.env.HOST || '0.0.0.0',
      nodeEnv: process.env.NODE_ENV || 'development'
    },
    cache: {
      ttl: parseInt(process.env.CACHE_TTL) || 300,
      maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 10000
    },
    api: {
      timeout: parseInt(process.env.API_TIMEOUT) || 10000,
      retryCount: parseInt(process.env.API_RETRY_COUNT) || 3,
      retryDelay: parseInt(process.env.API_RETRY_DELAY) || 1000
    },
    rateLimit: {
      max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
      window: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000
    }
  };
}

// 辅助函数：生成CSV格式的统计数据
function generateCSVStats(stats) {
  const lines = [];
  lines.push('Metric,Value,Unit,Timestamp');
  lines.push(`Total Requests,${stats.totalRequests},count,${new Date().toISOString()}`);
  lines.push(`Cache Hits,${stats.cacheHits},count,${new Date().toISOString()}`);
  lines.push(`API Calls,${stats.apiCalls},count,${new Date().toISOString()}`);
  lines.push(`Errors,${stats.errors},count,${new Date().toISOString()}`);
  lines.push(`Cache Hit Rate,${stats.cacheHitRate},%,${new Date().toISOString()}`);
  lines.push(`Uptime,${stats.uptime},seconds,${new Date().toISOString()}`);
  lines.push(`Available API Keys,${stats.apiKeys.available},count,${new Date().toISOString()}`);
  lines.push(`Cache Size,${stats.cacheKeys},count,${new Date().toISOString()}`);
  
  return lines.join('\n');
}

module.exports = statsRoutes; 