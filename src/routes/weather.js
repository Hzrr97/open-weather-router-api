'use strict';

const Joi = require('joi');
const WeatherService = require('../services/WeatherService');

// 全局WeatherService实例 (单例模式)
let weatherServiceInstance = null;

// 参数验证模式
const querySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required()
    .messages({
      'number.base': 'lat必须是数字',
      'number.min': 'lat必须大于等于-90',
      'number.max': 'lat必须小于等于90',
      'any.required': 'lat参数是必需的'
    }),
  
  lon: Joi.number().min(-180).max(180).required()
    .messages({
      'number.base': 'lon必须是数字',
      'number.min': 'lon必须大于等于-180',
      'number.max': 'lon必须小于等于180',
      'any.required': 'lon参数是必需的'
    }),

  appid: Joi.string().required()
    .messages({
      'string.base': 'appid必须是字符串',
      'any.required': 'appid参数是必需的'
    }),
    
  exclude: Joi.string().pattern(/^(current|minutely|hourly|daily|alerts)(,(current|minutely|hourly|daily|alerts))*$/)
    .messages({
      'string.pattern.base': 'exclude参数格式错误，可选值：current,minutely,hourly,daily,alerts'
    }),
    
  units: Joi.string().valid('standard', 'metric', 'imperial')
    .messages({
      'any.only': 'units参数必须是：standard, metric, imperial 之一'
    }),
    
  lang: Joi.string().min(2).max(5)
    .messages({
      'string.min': 'lang参数长度至少2个字符',
      'string.max': 'lang参数长度最多5个字符'
    })
});

async function weatherRoutes(fastify, options) {
  // 初始化WeatherService实例
  if (!weatherServiceInstance) {
    weatherServiceInstance = new WeatherService();
  }
  
  const weatherService = weatherServiceInstance;

  // Fastify Schema定义用于文档生成和验证
  const onecallSchema = {
    querystring: {
      type: 'object',
      properties: {
        lat: { 
          type: 'number',
          minimum: -90,
          maximum: 90,
          description: '纬度，范围 -90 到 90'
        },
        lon: { 
          type: 'number',
          minimum: -180,
          maximum: 180,
          description: '经度，范围 -180 到 180'
        },
        appid: {
          type: 'string',
          description: '接口鉴权密钥'
        },
        exclude: { 
          type: 'string',
          pattern: '^(current|minutely|hourly|daily|alerts)(,(current|minutely|hourly|daily|alerts))*$',
          description: '排除的数据部分，可选值：current,minutely,hourly,daily,alerts'
        },
        units: { 
          type: 'string',
          enum: ['standard', 'metric', 'imperial'],
          description: '单位制，可选值：standard, metric, imperial'
        },
        lang: { 
          type: 'string',
          minLength: 2,
          maxLength: 5,
          description: '语言代码，如：en, zh_cn'
        }
      },
      required: ['lat', 'lon', 'appid']
    },
    response: {
      // 移除200的严格schema限制，允许任意对象结构
      200: {
        type: 'object'
      },
      400: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          error: { type: 'string' },
          timestamp: { type: 'string' },
          requestId: { type: 'string' }
        }
      },
      401: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          error: { type: 'string' },
          timestamp: { type: 'string' },
          requestId: { type: 'string' }
        }
      },
      429: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          error: { type: 'string' },
          retryAfter: { type: 'number' },
          timestamp: { type: 'string' }
        }
      },
      500: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          error: { type: 'string' },
          timestamp: { type: 'string' },
          requestId: { type: 'string' }
        }
      }
    }
  };

  // 主要API路由 - 获取天气数据
  fastify.get('/onecall', {
    schema: {
      tags: ['weather'],
      summary: '获取天气数据',
      description: '获取指定位置的详细天气信息，包括当前天气、分钟级、小时级、日级预报等',
      querystring: onecallSchema.querystring,
    },
    preHandler: async (request, reply) => {
      // 请求预处理 - 记录请求信息
      request.log.info({
        query: request.query,
        ip: request.ip,
        userAgent: request.headers['user-agent']
      }, 'Weather API request received');
    }
  }, async (request, reply) => {
    const startTime = Date.now();
    
    // 添加进程ID日志，用于测试集群模式
    request.log.info({
      processId: process.pid,
      clusterId: process.env.pm_id || 'unknown',
      workerId: process.env.NODE_APP_INSTANCE || 'unknown'
    }, `🔀 [进程 ${process.pid}] 处理请求 - Cluster ID: ${process.env.pm_id || 'N/A'}`);
    
    try {
      // 验证appid参数
      const { appid, ...weatherParams } = request.query;
      const expectedAppId = process.env.APP_ID_KEY;
      
      if (!expectedAppId) {
        return reply.status(500).send({
          success: false,
          error: '服务器配置错误：缺少APP_ID_KEY环境变量',
          timestamp: new Date().toISOString(),
          requestId: request.id
        });
      }
      
      if (appid !== expectedAppId) {
        return reply.status(401).send({
          success: false,
          error: '无效的appid参数',
          timestamp: new Date().toISOString(),
          requestId: request.id
        });
      }
      
      // 获取天气数据，传递除appid外的其他参数
      const result = await weatherService.getWeatherData(weatherParams);
      
      // 设置响应时间头
      reply.header('X-Response-Time', `${Date.now() - startTime}ms`);
      
      // 记录成功日志
      request.log.info({
        responseTime: Date.now() - startTime,
        hasData: !!result
      }, 'Weather API request completed successfully');
      
      // 确保返回有效的数据
      if (!result) {
        return reply.status(500).send({
          success: false,
          error: '无法获取天气数据',
          timestamp: new Date().toISOString(),
          requestId: request.id
        });
      }
      
      // 直接返回原始数据
      return result;
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // 记录错误日志
      request.log.error({
        error: error.message,
        responseTime,
        query: request.query
      }, 'Weather API request failed');
      
      // 根据错误类型返回不同状态码
      let statusCode = 500;
      if (error.response) {
        // API响应错误
        statusCode = error.response.status;
        return reply.status(statusCode).send(error.response.data);
      } else if (error.request) {
        // 网络错误
        statusCode = 503;
      } else if (error.message.includes('限制') || error.message.includes('quota')) {
        statusCode = 429;
      }
      
      return reply.status(statusCode).send({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        requestId: request.id,
        responseTime
      });
    }
  });

  // 清空缓存接口 (管理功能)
  fastify.delete('/cache', {
    schema: {
      tags: ['cache'],
      summary: '清空缓存',
      description: '清空所有天气数据缓存'
    }
  }, async (request, reply) => {
    try {
      const result = weatherService.clearCache();
      
      request.log.info({ clearedItems: result.message }, 'Cache cleared');
      
      return result;
    } catch (error) {
      request.log.error({ error: error.message }, 'Failed to clear cache');
      
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });

  // 缓存预热接口 (管理功能)
  fastify.post('/cache/warmup', {
    schema: {
      tags: ['cache'],
      summary: '缓存预热',
      description: '为指定位置列表预热缓存数据',
      body: {
        type: 'object',
        properties: {
          locations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lat: { type: 'number' },
                lon: { type: 'number' },
                units: { type: 'string' },
                lang: { type: 'string' }
              },
              required: ['lat', 'lon']
            }
          }
        },
        required: ['locations']
      }
    }
  }, async (request, reply) => {
    try {
      const { locations } = request.body;
      
      if (!Array.isArray(locations) || locations.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'locations必须是非空数组'
        });
      }

      if (locations.length > 100) {
        return reply.status(400).send({
          success: false,
          error: '一次最多预热100个位置'
        });
      }

      const result = await weatherService.warmupCache(locations);
      
      request.log.info({ 
        locationCount: locations.length,
        results: result.results 
      }, 'Cache warmup completed');
      
      return result;
    } catch (error) {
      request.log.error({ error: error.message }, 'Cache warmup failed');
      
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });

  // 获取缓存信息
  fastify.get('/cache/info', {
    schema: {
      tags: ['cache'],
      summary: '获取缓存信息',
      description: '查看当前缓存状态和统计信息'
    }
  }, async (request, reply) => {
    try {
      const stats = await weatherService.getStats();
      
      return {
        success: true,
        cache: {
          enabled: stats.cacheEnabled || false,
          size: stats.cacheKeys,
          maxSize: parseInt(process.env.CACHE_MAX_KEYS) || 10000,
          hitRate: stats.cacheHitRate,
          hits: stats.cacheHits,
          writes: stats.cacheWrites,
          ttl: `${parseInt(process.env.CACHE_TTL) || 300}s`,
          status: stats.cacheEnabled ? 'active' : 'disabled'
        }
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error.message
      });
    }
  });

  // API使用示例接口 (帮助文档)
  fastify.get('/examples', {
    schema: {
      tags: ['weather'],
      summary: 'API使用示例',
      description: '获取API使用示例和参数说明'
    }
  }, async (request, reply) => {
    const baseUrl = `${request.protocol}://${request.hostname}${request.url.replace('/examples', '')}`;
    
    return {
      success: true,
      message: 'OpenWeather API 使用示例',
      examples: {
        basic: {
          description: '基础天气查询 (北京)',
          url: `${baseUrl}/onecall?lat=39.9042&lon=116.4074&appid=your_app_id`
        },
        metric: {
          description: '公制单位 + 中文 (上海)',
          url: `${baseUrl}/onecall?lat=31.2304&lon=121.4737&units=metric&lang=zh_cn&appid=your_app_id`
        },
        exclude: {
          description: '排除分钟级和小时级数据 (纽约)',
          url: `${baseUrl}/onecall?lat=40.7128&lon=-74.0060&exclude=minutely,hourly&units=imperial&appid=your_app_id`
        },
        minimal: {
          description: '只获取当前天气 (伦敦)',
          url: `${baseUrl}/onecall?lat=51.5074&lon=-0.1278&exclude=minutely,hourly,daily,alerts&units=metric&appid=your_app_id`
        }
      },
      parameters: {
        required: {
          lat: 'number (-90 到 90)',
          lon: 'number (-180 到 180)',
          appid: 'string (接口鉴权密钥)'
        },
        optional: {
          exclude: 'string (current,minutely,hourly,daily,alerts)',
          units: 'string (standard,metric,imperial)',
          lang: 'string (语言代码，如: en, zh_cn)'
        }
      }
    };
  });

  // 钩子：在路由注册完成后
  fastify.addHook('onReady', async () => {
    fastify.log.info('Weather routes registered successfully');
  });

  // 钩子：在服务关闭时清理资源
  fastify.addHook('onClose', async () => {
    if (weatherServiceInstance) {
      weatherServiceInstance.destroy();
      weatherServiceInstance = null;
    }
  });
}

module.exports = weatherRoutes; 