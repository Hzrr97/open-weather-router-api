'use strict';

// 初始化日志管理器
const logManager = require('./utils/logManager');

const fastify = require('fastify')({
  logger: process.env.NODE_ENV === 'development' ? {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  } : {
    level: process.env.LOG_LEVEL || 'info'
  },
  trustProxy: true,
  keepAliveTimeout: parseInt(process.env.KEEPALIVE_TIMEOUT) || 30000,
});

// 加载环境变量
require('dotenv').config();

// 添加日志钩子 - 将重要日志写入文件
fastify.addHook('onRequest', async (request, reply) => {
  const logData = {
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    timestamp: new Date().toISOString()
  };
  
  // 记录请求到文件
  logManager.write('info', 'incoming request', logData);
});

fastify.addHook('onResponse', async (request, reply) => {
  const logData = {
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    responseTime: reply.getResponseTime(),
    ip: request.ip,
    timestamp: new Date().toISOString()
  };
  
  // 记录响应到文件
  logManager.write('info', 'request completed', logData);
});

// 重写错误日志，同时写入文件
const originalError = fastify.log.error;
fastify.log.error = function(obj, msg, ...args) {
  // 写入文件
  logManager.write('error', msg || 'Error occurred', typeof obj === 'object' ? obj : { error: obj });
  // 调用原始方法
  return originalError.call(this, obj, msg, ...args);
};

// 全局错误处理
process.on('uncaughtException', (err) => {
  fastify.log.error('Uncaught Exception:', err);
  logManager.write('error', 'Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  fastify.log.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logManager.write('error', 'Unhandled Rejection', { reason: reason, promise: promise });
  process.exit(1);
});

// 注册插件
async function registerPlugins() {
  // Swagger API 文档 (仅在开发环境或明确启用时)
  if (process.env.NODE_ENV === 'development' || process.env.ENABLE_SWAGGER === 'true') {
    await fastify.register(require('@fastify/swagger'), {
      swagger: {
        info: {
          title: 'OpenWeather API Router',
          description: '高性能的OpenWeatherMap API代理服务，支持多账号负载均衡和智能请求限制管理',
          version: '1.0.0',
          contact: {
            name: 'API Support',
            email: 'support@example.com'
          }
        },
        host: process.env.HOST || 'localhost:3000',
        schemes: ['http', 'https'],
        consumes: ['application/json'],
        produces: ['application/json'],
        tags: [
          { name: 'weather', description: '天气数据相关接口' },
          { name: 'health', description: '健康检查接口' },
          { name: 'stats', description: '统计信息接口' },
          { name: 'cache', description: '缓存管理接口' }
        ]
      }
    });

    await fastify.register(require('@fastify/swagger-ui'), {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false
      },
      staticCSP: true,
      transformSpecificationClone: true
    });
  }

  // CORS支持
  await fastify.register(require('@fastify/cors'), {
    origin: process.env.CORS_ORIGIN || true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
  });

  // 安全头
  await fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  });

  // 速率限制
  await fastify.register(require('@fastify/rate-limit'), {
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
    errorResponseBuilder: (request, context) => {
      return {
        success: false,
        error: `Rate limit exceeded, retry in ${Math.round(context.ttl / 1000)} seconds`,
        retryAfter: Math.round(context.ttl / 1000),
        timestamp: new Date().toISOString()
      };
    }
  });
}

// 注册路由
async function registerRoutes() {
  // 根路径
  fastify.get('/', async (request, reply) => {
    return {
      service: 'OpenWeather API Router',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString(),
      endpoints: {
        weather: '/data/3.0/onecall',
        health: '/health',
        stats: '/stats'
      }
    };
  });

  // 天气API路由
  await fastify.register(require('./routes/weather'), { prefix: '/data/3.0' });
  
  // 健康检查路由
  await fastify.register(require('./routes/health'));
  
  // 统计路由
  await fastify.register(require('./routes/stats'));
}

// 全局错误处理
fastify.setErrorHandler((error, request, reply) => {
  const { statusCode = 500, message } = error;
  
  fastify.log.error({
    error: error,
    request: {
      method: request.method,
      url: request.url,
      headers: request.headers,
      ip: request.ip
    }
  });
  
  // 不暴露内部错误详情给客户端
  const clientMessage = statusCode >= 500 
    ? 'Internal Server Error' 
    : message;
  
  reply.status(statusCode).send({
    success: false,
    error: clientMessage,
    timestamp: new Date().toISOString(),
    requestId: request.id
  });
});

// 404处理
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    success: false,
    error: 'Route not found',
    path: request.url,
    method: request.method,
    timestamp: new Date().toISOString(),
    availableEndpoints: {
      weather: 'GET /data/3.0/onecall',
      health: 'GET /health',
      stats: 'GET /stats'
    }
  });
});

// 优雅关闭处理
async function gracefulShutdown(signal) {
  fastify.log.info(`收到 ${signal} 信号，开始优雅关闭...`);
  logManager.write('info', `收到 ${signal} 信号，开始优雅关闭...`, { signal });
  
  try {
    // 关闭日志管理器
    logManager.close();
    
    await fastify.close();
    fastify.log.info('✅ 服务器已安全关闭');
    process.exit(0);
  } catch (err) {
    fastify.log.error('❌ 关闭服务器时出错:', err);
    logManager.write('error', '关闭服务器时出错', { error: err.message });
    process.exit(1);
  }
}

// 监听关闭信号
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 配置验证
const ConfigValidator = require('./utils/configValidator');
const configResult = ConfigValidator.printValidationResult();

if (!configResult.valid) {
  console.error('❌ 配置验证失败，应用无法启动');
  process.exit(1);
}

// 初始化应用（注册插件和路由）
async function initializeApp() {
  try {
    await registerPlugins();
    await registerRoutes();
    return fastify;
  } catch (err) {
    fastify.log.error('初始化应用失败:', err);
    throw err;
  }
}

// 启动服务器
async function start() {
  try {
    // 验证必需的环境变量
    if (!process.env.OPENWEATHER_API_KEYS) {
      throw new Error('OPENWEATHER_API_KEYS 环境变量是必需的');
    }

    const port = parseInt(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    
    console.log('🌤️ ===============================================');
    console.log('🌤️  OpenWeather API Router 启动成功!');
    console.log('🌤️ ===============================================');
    console.log(`📡 服务地址: http://${host}:${port}`);
    console.log(`🏥 健康检查: http://${host}:${port}/health`);
    console.log(`📊 统计信息: http://${host}:${port}/stats`);
    console.log(`🌍 天气接口: http://${host}:${port}/data/3.0/onecall`);
    console.log(`📝 日志管理: http://${host}:${port}/logs/stats`);
    console.log(`📋 API文档: http://${host}:${port}/docs`);
    
    // 显示日志配置信息
    const logStats = logManager.getLogStats();
    console.log(`📄 当前日志文件: ${logStats.currentLogFile}`);
    console.log(`🗂️ 日志文件数量: ${logStats.totalFiles}`);
    console.log(`💾 日志总大小: ${logStats.totalSizeFormatted}`);
    console.log(`🗑️ 日志保留天数: ${logStats.retentionDays}天`);
    console.log('🌤️ ===============================================');
    
    fastify.log.info({
      msg: 'Server started successfully',
      port,
      host,
      nodeEnv: process.env.NODE_ENV,
      nodeVersion: process.version,
      pid: process.pid
    });
    
  } catch (err) {
    fastify.log.error('启动服务器失败:', err);
    process.exit(1);
  }
}

// 立即初始化应用
const appPromise = initializeApp();

// 如果直接运行此文件，启动服务器
if (require.main === module) {
  appPromise.then(() => {
    start();
  }).catch((err) => {
    console.error('应用初始化失败:', err);
    process.exit(1);
  });
}

// 导出初始化后的fastify实例
module.exports = appPromise.then(() => fastify); 