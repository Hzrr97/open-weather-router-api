// ecosystem.config.js - PM2 配置文件
module.exports = {
  apps: [
    {
      name: 'weather-api-dev',
      script: './src/app.js',
      instances: 1,
      exec_mode: 'fork',
      watch: true,
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log',
        '.git'
      ],
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        LOG_LEVEL: 'debug',
        HOST: '0.0.0.0'
      },
      // 日志配置
      log_file: './logs/pm2-dev-combined.log',
      out_file: './logs/pm2-dev-out.log',
      error_file: './logs/pm2-dev-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // 进程管理
      min_uptime: '10s',
      max_restarts: 10,
      autorestart: true,
      
      // 优雅重启
      kill_timeout: 5000,
      listen_timeout: 3000,
      shutdown_with_message: true,
      wait_ready: true,
      
      // 实例标识
      instance_var: 'INSTANCE_ID',
      
      // Windows 特殊配置
      windowsHide: true,
      
      // 合并日志
      merge_logs: true,
      time: true
    },
    {
      name: 'weather-api-prod',
      script: './src/app.js',
      instances: 4,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        LOG_LEVEL: 'info',
        HOST: '0.0.0.0'
      },
      // 日志配置
      log_file: './logs/pm2-prod-combined.log',
      out_file: './logs/pm2-prod-out.log',
      error_file: './logs/pm2-prod-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // 进程管理
      min_uptime: '10s',
      max_restarts: 10,
      autorestart: true,
      
      // 优雅重启
      kill_timeout: 5000,
      listen_timeout: 3000,
      shutdown_with_message: true,
      wait_ready: true,
      
      // 集群优化
      node_args: '--max-old-space-size=512',
      
      // 实例标识
      instance_var: 'INSTANCE_ID',
      
      // Windows 特殊配置
      windowsHide: true,
      
      // 合并日志
      merge_logs: true,
      time: true
    }
  ],

  // 部署配置（可选）
  deploy: {
    production: {
      user: 'deploy',
      host: ['your-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:username/open-weather-router-api.git',
      path: '/var/www/weather-api',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --only weather-api-prod',
      env: {
        NODE_ENV: 'production'
      }
    }
  }
}; 