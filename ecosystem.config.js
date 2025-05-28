// ecosystem.config.js - PM2 配置文件 (单机4核8GB优化版)
module.exports = {
  apps: [
    {
      name: 'weather-api',
      script: './src/app.js',
      instances: 4, // 4核服务器使用4个实例
      exec_mode: 'cluster', // 集群模式
      watch: false, // 生产环境不启用监听
      max_memory_restart: '200M', // 单进程内存限制 (优化)
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
        LOG_LEVEL: 'debug',
        instances: 1, // 开发环境单进程
        watch: true
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        LOG_LEVEL: 'info'
      },
      // 日志配置
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // 进程管理
      min_uptime: '10s',
      max_restarts: 10,
      autorestart: true,
      
      // 集群配置
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // 性能监控
      pmx: true,
      monitoring: false,
      
      // 优雅重启
      shutdown_with_message: true,
      wait_ready: true,
      
      // 环境变量
      source_map_support: true,
      
      // 内存优化 (4核8GB服务器)
      node_args: '--max-old-space-size=256 --optimize-for-size',
      
      // 健康检查
      health_check_grace_period: 3000,
      
      // 自动重启条件
      restart_delay: 4000,
      exponential_backoff_restart_delay: 100,
      
      // 实例配置
      instance_var: 'INSTANCE_ID',
      
      // Windows 特殊配置
      windowsHide: true,
      
      // 增量重启 (零停机部署)
      increment_var: 'PORT',
      
      // 合并日志
      merge_logs: true,
      
      // 时间戳
      time: true
    }
  ],

  // 部署配置
  deploy: {
    production: {
      user: 'root',
      host: ['your-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:username/open-weather-router-api.git',
      path: '/var/www/weather-api',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      env: {
        NODE_ENV: 'production'
      }
    },
    
    staging: {
      user: 'deploy',
      host: 'staging-server.com',
      ref: 'origin/develop',
      repo: 'git@github.com:username/open-weather-router-api.git',
      path: '/var/www/weather-api-staging',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging'
      }
    }
  }
}; 