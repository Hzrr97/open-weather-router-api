// tests/weather.test.js
'use strict';

const { test, beforeAll, afterAll } = require('@jest/globals');
const supertest = require('supertest');

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.OPENWEATHER_API_KEYS = 'test_key_1,test_key_2';
process.env.ENABLE_CACHE = 'true';        // 测试环境启用缓存
process.env.CACHE_TTL = '60';
process.env.CACHE_MAX_KEYS = '1000';
process.env.API_DAILY_LIMIT = '2000'; // 测试环境每日限制

let app;
let request;

beforeAll(async () => {
  // 等待异步的app初始化完成
  app = await require('../src/app');
  await app.ready();
  request = supertest(app.server);
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe('天气API测试', () => {
  test('GET / - 根路径应该返回服务信息', async () => {
    const response = await request
      .get('/')
      .expect(200);

    expect(response.body).toMatchObject({
      service: 'OpenWeather API Router',
      version: '1.0.0',
      status: 'running'
    });
  });

  test('GET /health - 健康检查应该返回状态', async () => {
    const response = await request
      .get('/health')
      .expect(200);

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('uptime');
  });

  test('GET /stats - 统计信息应该返回正确格式', async () => {
    const response = await request
      .get('/stats')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      keys: expect.any(Array),
      performance: expect.any(Object),
      cache: expect.any(Object)
    });
  });

  test('GET /data/3.0/onecall - 缺少必需参数应该返回400', async () => {
    const response = await request
      .get('/data/3.0/onecall')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.any(String)
    });
  });

  test('GET /data/3.0/onecall - 无效的纬度应该返回400', async () => {
    const response = await request
      .get('/data/3.0/onecall?lat=invalid&lon=0')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining('lat')
    });
  });

  test('GET /data/3.0/onecall - 无效的经度应该返回400', async () => {
    const response = await request
      .get('/data/3.0/onecall?lat=0&lon=invalid')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining('lon')
    });
  });

  test('GET /data/3.0/onecall - 纬度超出范围应该返回400', async () => {
    const response = await request
      .get('/data/3.0/onecall?lat=91&lon=0')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining('90')
    });
  });

  test('GET /data/3.0/onecall - 经度超出范围应该返回400', async () => {
    const response = await request
      .get('/data/3.0/onecall?lat=0&lon=181')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining('180')
    });
  });

  test('GET /data/3.0/onecall - 无效的exclude参数应该返回400', async () => {
    const response = await request
      .get('/data/3.0/onecall?lat=0&lon=0&exclude=invalid')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining('exclude')
    });
  });

  test('GET /data/3.0/onecall - 无效的units参数应该返回400', async () => {
    const response = await request
      .get('/data/3.0/onecall?lat=0&lon=0&units=invalid')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining('units')
    });
  });

  test('GET /data/3.0/examples - 使用示例应该返回帮助信息', async () => {
    const response = await request
      .get('/data/3.0/examples')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      message: expect.any(String),
      examples: expect.any(Object),
      parameters: expect.any(Object)
    });
  });

  test('GET /data/3.0/cache/info - 缓存信息应该返回正确格式', async () => {
    const response = await request
      .get('/data/3.0/cache/info')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      cache: {
        size: expect.any(Number),
        maxSize: expect.any(Number),
        hitRate: expect.any(String),
        ttl: expect.any(String)
      }
    });
  });

  test('DELETE /data/3.0/cache - 清空缓存应该成功', async () => {
    const response = await request
      .delete('/data/3.0/cache')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      message: expect.any(String)
    });
  });

  test('GET /ready - 就绪检查应该返回状态', async () => {
    const response = await request
      .get('/ready')
      .expect(200);

    expect(response.body).toMatchObject({
      ready: true,
      timestamp: expect.any(String)
    });
  });

  test('GET /live - 存活检查应该返回状态', async () => {
    const response = await request
      .get('/live')
      .expect(200);

    expect(response.body).toMatchObject({
      alive: true,
      timestamp: expect.any(String),
      uptime: expect.any(Number)
    });
  });

  test('GET /version - 版本信息应该返回正确格式', async () => {
    const response = await request
      .get('/version')
      .expect(200);

    expect(response.body).toMatchObject({
      name: expect.any(String),
      version: expect.any(String),
      description: expect.any(String),
      nodeVersion: expect.any(String),
      dependencies: expect.any(Object)
    });
  });

  test('GET /nonexistent - 404路由应该返回正确错误信息', async () => {
    const response = await request
      .get('/nonexistent')
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: 'Route not found',
      path: '/nonexistent',
      method: 'GET',
      availableEndpoints: expect.any(Object)
    });
  });
});

describe('API密钥管理测试', () => {
  test('GET /stats/keys - API密钥统计应该返回正确格式', async () => {
    const response = await request
      .get('/stats/keys')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      summary: {
        total: expect.any(Number),
        available: expect.any(Number),
        blocked: expect.any(Number),
        dailyLimit: 2000
      },
      keys: expect.any(Array)
    });
  });

  test('统计信息中应该包含正确的密钥数量', async () => {
    const response = await request
      .get('/stats/keys')
      .expect(200);

    // 测试环境配置了2个密钥
    expect(response.body.summary.total).toBe(2);
  });
});

describe('缓存功能测试', () => {
  test('GET /stats/cache - 缓存统计应该返回正确格式', async () => {
    const response = await request
      .get('/stats/cache')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      cache: {
        size: expect.any(Number),
        maxSize: expect.any(Number),
        hitRate: expect.any(String),
        hits: expect.any(Number),
        writes: expect.any(Number),
        ttl: expect.any(Number),
        efficiency: expect.any(Object)
      }
    });
  });

  test('POST /data/3.0/cache/warmup - 缓存预热需要locations参数', async () => {
    const response = await request
      .post('/data/3.0/cache/warmup')
      .send({})
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining('locations')
    });
  });

  test('POST /data/3.0/cache/warmup - 空locations数组应该返回错误', async () => {
    const response = await request
      .post('/data/3.0/cache/warmup')
      .send({ locations: [] })
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: expect.stringContaining('非空数组')
    });
  });
});

describe('性能监控测试', () => {
  test('GET /stats/performance - 性能统计应该返回正确格式', async () => {
    const response = await request
      .get('/stats/performance')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      performance: {
        totalRequests: expect.any(Number),
        errors: expect.any(Number),
        errorRate: expect.any(String),
        qps: expect.any(Number),
        responseTime: expect.any(Object),
        throughput: expect.any(Object)
      },
      trends: expect.any(Object)
    });
  });

  test('GET /stats/detailed - 详细统计应该包含所有模块', async () => {
    const response = await request
      .get('/stats/detailed')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      overview: expect.any(Object),
      apiKeys: expect.any(Object),
      cache: expect.any(Object),
      performance: expect.any(Object),
      system: expect.any(Object),
      config: expect.any(Object)
    });
  });

  test('GET /stats/export?format=csv - CSV导出应该返回正确格式', async () => {
    const response = await request
      .get('/stats/export?format=csv')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('Metric,Value,Unit,Timestamp');
  });
});

describe('错误处理测试', () => {
  test('服务器应该正确处理预期的错误', async () => {
    // 测试各种错误情况...
    expect(true).toBe(true); // 占位测试
  });
}); 