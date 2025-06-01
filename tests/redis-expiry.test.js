'use strict';

const { describe, it, beforeEach, afterEach, before, after } = require('mocha');
const { expect } = require('chai');

describe('Redis过期时间测试', () => {
  let manager;
  const ApiKeyManager = require('../src/services/ApiKeyManager');

  before(async () => {
    // 设置测试环境变量
    process.env.OPENWEATHER_API_KEYS = 'test_key_1,test_key_2,test_key_3';
    process.env.API_DAILY_LIMIT = '10';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    process.env.REDIS_DB = '1'; // 使用不同的数据库避免冲突
  });

  beforeEach(async () => {
    manager = new ApiKeyManager();
    // 等待Redis连接
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterEach(async () => {
    if (manager) {
      await manager.resetAllUsage();
      manager.destroy();
      manager = null;
    }
  });

  it('应该正确设置Redis键的过期时间', async () => {
    const keyId = 'key_1';
    
    // 记录使用
    await manager.recordUsage(keyId);
    
    // 检查键是否存在
    const usage = await manager.getKeyUsage(keyId);
    expect(usage).to.equal(1);
    
    // 检查TTL (应该小于等于48小时)
    const today = manager.getTodayString();
    const usageKey = `usage:${keyId}:${today}`;
    const timeKey = `times:${keyId}:${today}`;
    
    if (manager.redis && manager.redisConnected) {
      const usageTTL = await manager.redis.ttl(usageKey);
      const timeTTL = await manager.redis.ttl(timeKey);
      
      expect(usageTTL).to.be.greaterThan(0);
      expect(usageTTL).to.be.lessThanOrEqual(48 * 60 * 60);
      expect(timeTTL).to.be.greaterThan(0);
      expect(timeTTL).to.be.lessThanOrEqual(48 * 60 * 60);
    }
  });

  it('应该在48小时后自动清理过期数据', async () => {
    const keyId = 'key_2';
    
    // 模拟过期键
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toISOString().split('T')[0];
    
    if (manager.redis && manager.redisConnected) {
      const usageKey = `usage:${keyId}:${yesterdayString}`;
      const timeKey = `times:${keyId}:${yesterdayString}`;
      
      // 手动设置过期键
      await manager.redis.set(usageKey, '5');
      await manager.redis.lpush(timeKey, Date.now());
      await manager.redis.expire(usageKey, 1); // 1秒后过期
      await manager.redis.expire(timeKey, 1);
      
      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 检查键是否已过期
      const exists1 = await manager.redis.exists(usageKey);
      const exists2 = await manager.redis.exists(timeKey);
      
      expect(exists1).to.equal(0);
      expect(exists2).to.equal(0);
    }
  });

  it('应该正确清理非当天的使用记录', async () => {
    if (manager.redis && manager.redisConnected) {
      // 创建一些测试数据
      const today = manager.getTodayString();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayString = yesterday.toISOString().split('T')[0];
      
      // 设置今天和昨天的数据
      await manager.redis.set(`usage:key_1:${today}`, '3');
      await manager.redis.set(`usage:key_1:${yesterdayString}`, '5');
      await manager.redis.lpush(`times:key_1:${today}`, Date.now());
      await manager.redis.lpush(`times:key_1:${yesterdayString}`, Date.now() - 86400000);
      
      // 执行清理
      await manager.cleanupOldUsage();
      
      // 检查结果
      const todayExists = await manager.redis.exists(`usage:key_1:${today}`);
      const yesterdayExists = await manager.redis.exists(`usage:key_1:${yesterdayString}`);
      
      expect(todayExists).to.equal(1); // 今天的数据应该保留
      expect(yesterdayExists).to.equal(0); // 昨天的数据应该被清理
    }
  });

  it('应该支持获取剩余配额', async () => {
    // 使用一些配额
    await manager.recordUsage('key_1');
    await manager.recordUsage('key_1');
    await manager.recordUsage('key_2');
    
    const remainingQuota = await manager.getRemainingQuota();
    
    // 总配额 = 3个key * 10次/天 = 30
    // 已使用 = 3次
    // 剩余 = 27次
    expect(remainingQuota).to.equal(27);
  });

  it('应该支持重置指定密钥的使用计数', async () => {
    const keyId = 'key_3';
    
    // 记录一些使用
    await manager.recordUsage(keyId);
    await manager.recordUsage(keyId);
    
    let usage = await manager.getKeyUsage(keyId);
    expect(usage).to.equal(2);
    
    // 重置
    await manager.resetKeyUsage(keyId);
    
    usage = await manager.getKeyUsage(keyId);
    expect(usage).to.equal(0);
  });

  it('应该在连接断开时优雅降级', async () => {
    // 断开Redis连接
    if (manager.redis) {
      manager.redis.disconnect();
      manager.redisConnected = false;
    }
    
    // 尝试获取密钥应该抛出错误
    try {
      await manager.getAvailableKey();
      expect.fail('应该抛出Redis连接错误');
    } catch (error) {
      expect(error.message).to.include('Redis连接不可用');
    }
    
    // 记录使用应该静默失败
    await manager.recordUsage('key_1'); // 不应该抛出错误
    
    // 获取统计应该返回默认值
    const stats = await manager.getStats();
    expect(stats.error).to.include('Redis连接不可用');
  });
});

// 性能测试
describe('Redis性能测试', () => {
  let manager;
  const ApiKeyManager = require('../src/services/ApiKeyManager');

  before(() => {
    process.env.OPENWEATHER_API_KEYS = 'perf_key_1,perf_key_2';
    process.env.API_DAILY_LIMIT = '1000';
    process.env.REDIS_DB = '2';
  });

  beforeEach(async () => {
    manager = new ApiKeyManager();
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (manager) {
      await manager.resetAllUsage();
      manager.destroy();
    }
  });

  it('应该能够处理大量并发请求', async () => {
    const concurrency = 100;
    const promises = [];
    
    for (let i = 0; i < concurrency; i++) {
      promises.push(manager.recordUsage('perf_key_1'));
    }
    
    const startTime = Date.now();
    await Promise.all(promises);
    const endTime = Date.now();
    
    const usage = await manager.getKeyUsage('perf_key_1');
    expect(usage).to.equal(concurrency);
    
    const duration = endTime - startTime;
    console.log(`并发写入 ${concurrency} 次耗时: ${duration}ms`);
    expect(duration).to.be.lessThan(5000); // 应该在5秒内完成
  }).timeout(10000);
}); 