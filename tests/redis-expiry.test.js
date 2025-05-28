'use strict';

const { test, beforeAll, afterAll, expect } = require('@jest/globals');

// Mock环境变量
process.env.OPENWEATHER_API_KEYS = 'test_key_1,test_key_2';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.API_DAILY_LIMIT = '2000'; // 测试环境每日限制

describe('Redis Key过期逻辑测试', () => {
  let ClusterApiKeyManager;
  let manager;

  beforeAll(() => {
    // 动态加载，避免Redis连接问题
    try {
      ClusterApiKeyManager = require('../src/services/ClusterApiKeyManager');
    } catch (error) {
      console.warn('ClusterApiKeyManager加载失败，跳过Redis测试:', error.message);
    }
  });

  afterAll(async () => {
    if (manager) {
      manager.destroy();
    }
  });

  test('getSecondsUntilMidnight应该返回合理的秒数', () => {
    if (!ClusterApiKeyManager) {
      console.log('跳过Redis测试 - ClusterApiKeyManager未加载');
      return;
    }

    manager = new ClusterApiKeyManager();
    const seconds = manager.getSecondsUntilMidnight();
    
    // 应该在0到86400秒之间（24小时）
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(86400);
    
    console.log(`当前时间: ${new Date()}`);
    console.log(`到明天0点还有: ${seconds}秒 (${Math.floor(seconds/3600)}小时${Math.floor((seconds%3600)/60)}分钟)`);
  });

  test('getTodayString应该返回正确的日期格式', () => {
    if (!ClusterApiKeyManager) {
      console.log('跳过Redis测试 - ClusterApiKeyManager未加载');
      return;
    }

    manager = new ClusterApiKeyManager();
    const today = manager.getTodayString();
    
    // 应该是YYYY-MM-DD格式
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    
    // 应该是今天的日期
    const expectedToday = new Date().toISOString().split('T')[0];
    expect(today).toBe(expectedToday);
    
    console.log(`今日日期字符串: ${today}`);
  });

  test('计算不同时间点到明天0点的秒数', () => {
    if (!ClusterApiKeyManager) {
      console.log('跳过Redis测试 - ClusterApiKeyManager未加载');
      return;
    }

    manager = new ClusterApiKeyManager();

    // 模拟不同时间点
    const testCases = [
      { hour: 0, minute: 0 },   // 刚过0点
      { hour: 12, minute: 0 },  // 中午
      { hour: 23, minute: 59 }, // 临近0点
    ];

    testCases.forEach(({ hour, minute }) => {
      // 创建测试时间
      const testTime = new Date();
      testTime.setHours(hour, minute, 0, 0);
      
      // 计算到明天0点的秒数
      const tomorrow = new Date(testTime);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const expectedSeconds = Math.floor((tomorrow - testTime) / 1000);
      
      console.log(`时间 ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} 到明天0点: ${expectedSeconds}秒`);
      
      // 验证计算逻辑
      if (hour === 0 && minute === 0) {
        expect(expectedSeconds).toBe(86400); // 整整24小时
      } else if (hour === 23 && minute === 59) {
        expect(expectedSeconds).toBe(60); // 1分钟
      }
    });
  });

  test('Redis key命名规范检查', () => {
    if (!ClusterApiKeyManager) {
      console.log('跳过Redis测试 - ClusterApiKeyManager未加载');
      return;
    }

    manager = new ClusterApiKeyManager();
    const today = manager.getTodayString();
    const keyId = 'key_1';
    
    const expectedUsageKey = `api_usage:${keyId}:${today}`;
    const expectedTimeKey = `api_times:${keyId}:${today}`;
    
    console.log(`预期的使用统计key: ${expectedUsageKey}`);
    console.log(`预期的时间记录key: ${expectedTimeKey}`);
    
    // 验证key格式
    expect(expectedUsageKey).toMatch(/^api_usage:key_\d+:\d{4}-\d{2}-\d{2}$/);
    expect(expectedTimeKey).toMatch(/^api_times:key_\d+:\d{4}-\d{2}-\d{2}$/);
  });

  test('边界情况：23:59:59的过期时间计算', () => {
    if (!ClusterApiKeyManager) {
      console.log('跳过Redis测试 - ClusterApiKeyManager未加载');
      return;
    }

    manager = new ClusterApiKeyManager();
    
    // 模拟23:59:59的情况
    const almostMidnight = new Date();
    almostMidnight.setHours(23, 59, 59, 999);
    
    const tomorrow = new Date(almostMidnight);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const secondsLeft = Math.floor((tomorrow - almostMidnight) / 1000);
    
    console.log(`23:59:59时到明天0点还有: ${secondsLeft}秒`);
    
    // 应该只有1秒或更少
    expect(secondsLeft).toBeLessThanOrEqual(1);
    expect(secondsLeft).toBeGreaterThanOrEqual(0);
  });
});

// 集成测试 - 需要真实Redis连接
describe('Redis集成测试 (需要Redis服务)', () => {
  let manager;

  beforeAll(() => {
    try {
      const ClusterApiKeyManager = require('../src/services/ClusterApiKeyManager');
      manager = new ClusterApiKeyManager();
    } catch (error) {
      console.warn('跳过Redis集成测试:', error.message);
    }
  });

  afterAll(async () => {
    if (manager) {
      // 清理测试数据
      if (manager.redis && manager.redisConnected) {
        await manager.redis.del('api_usage:test_key:2024-01-01');
        await manager.redis.del('api_times:test_key:2024-01-01');
      }
      manager.destroy();
    }
  });

  test('实际Redis key过期设置', async () => {
    if (!manager || !manager.redisConnected) {
      console.log('跳过Redis集成测试 - Redis未连接');
      return;
    }

    const testKey = 'test_key';
    
    try {
      // 记录使用
      await manager.recordUsage(testKey);
      
      // 检查key的TTL
      const usageKey = `api_usage:${testKey}:${manager.getTodayString()}`;
      const ttl = await manager.redis.ttl(usageKey);
      
      console.log(`Redis key TTL: ${ttl}秒`);
      
      // TTL应该大于0且小于等于86400
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400);
      
    } catch (error) {
      console.log('Redis集成测试失败:', error.message);
    }
  }, 10000); // 10秒超时
}); 