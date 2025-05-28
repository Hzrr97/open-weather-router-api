'use strict';

/**
 * 配置验证工具
 */
class ConfigValidator {
  static validateConfig() {
    const errors = [];
    const warnings = [];
    const config = {};

    // 验证必需的环境变量
    if (!process.env.OPENWEATHER_API_KEYS) {
      errors.push('OPENWEATHER_API_KEYS 环境变量是必需的');
    } else {
      const keys = process.env.OPENWEATHER_API_KEYS.split(',').filter(k => k.trim());
      config.apiKeysCount = keys.length;
      if (keys.length === 0) {
        errors.push('至少需要配置一个有效的API密钥');
      }
    }

    // 验证API每日限制
    const dailyLimit = parseInt(process.env.API_DAILY_LIMIT);
    if (process.env.API_DAILY_LIMIT && (isNaN(dailyLimit) || dailyLimit <= 0)) {
      errors.push('API_DAILY_LIMIT 必须是大于0的数字');
    } else {
      config.dailyLimit = dailyLimit || 2000;
      if (!process.env.API_DAILY_LIMIT) {
        warnings.push(`API_DAILY_LIMIT 未设置，使用默认值: ${config.dailyLimit}`);
      }
    }

    // 验证缓存配置
    config.cacheEnabled = process.env.ENABLE_CACHE !== 'false'; // 默认启用
    if (!process.env.ENABLE_CACHE) {
      warnings.push('ENABLE_CACHE 未设置，默认启用缓存');
    }

    const cacheTtl = parseInt(process.env.CACHE_TTL);
    if (process.env.CACHE_TTL && (isNaN(cacheTtl) || cacheTtl <= 0)) {
      warnings.push('CACHE_TTL 应该是大于0的数字，使用默认值 300');
      config.cacheTtl = 300;
    } else {
      config.cacheTtl = cacheTtl || 300;
    }

    const cacheMaxKeys = parseInt(process.env.CACHE_MAX_KEYS);
    if (process.env.CACHE_MAX_KEYS && (isNaN(cacheMaxKeys) || cacheMaxKeys <= 0)) {
      warnings.push('CACHE_MAX_KEYS 应该是大于0的数字，使用默认值 10000');
      config.cacheMaxKeys = 10000;
    } else {
      config.cacheMaxKeys = cacheMaxKeys || 10000;
    }

    // 缓存配置建议
    if (!config.cacheEnabled) {
      warnings.push('⚠️ 缓存已禁用，这将大幅增加API调用次数和响应时间');
    }

    // 验证集群模式配置
    config.clusterMode = process.env.ENABLE_CLUSTER_MODE !== 'false';
    if (config.clusterMode && !process.env.REDIS_URL) {
      warnings.push('启用集群模式但未配置REDIS_URL，将降级到本地模式');
    }

    // 计算总配额
    if (config.apiKeysCount) {
      config.totalDailyQuota = config.apiKeysCount * config.dailyLimit;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      config
    };
  }

  static printValidationResult() {
    const result = this.validateConfig();
    
    console.log('🔧 ===============================================');
    console.log('🔧  配置验证结果');
    console.log('🔧 ===============================================');
    
    if (result.valid) {
      console.log('✅ 配置验证通过');
    } else {
      console.log('❌ 配置验证失败');
      result.errors.forEach(error => {
        console.log(`  ❌ ${error}`);
      });
    }

    if (result.warnings.length > 0) {
      console.log('⚠️ 配置警告:');
      result.warnings.forEach(warning => {
        console.log(`  ⚠️ ${warning}`);
      });
    }

    console.log('📋 当前配置:');
    console.log(`  - API密钥数量: ${result.config.apiKeysCount || 0}`);
    console.log(`  - 每密钥每日限制: ${result.config.dailyLimit} 次`);
    console.log(`  - 总每日配额: ${result.config.totalDailyQuota || 0} 次`);
    console.log(`  - 缓存开关: ${result.config.cacheEnabled ? '启用' : '禁用'}`);
    console.log(`  - 缓存TTL: ${result.config.cacheTtl} 秒`);
    console.log(`  - 缓存最大数量: ${result.config.cacheMaxKeys}`);
    console.log(`  - 集群模式: ${result.config.clusterMode ? '启用' : '禁用'}`);
    console.log('🔧 ===============================================');

    return result;
  }
}

module.exports = ConfigValidator; 