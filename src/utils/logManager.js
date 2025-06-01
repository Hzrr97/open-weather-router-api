'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');

class LogManager {
  constructor() {
    this.baseLogFile = process.env.LOG_FILE || './logs/app.log';
    this.logDir = path.dirname(this.baseLogFile);
    this.retentionDays = parseInt(process.env.LOG_RETENTION_DAYS) || 30;
    this.currentLogFile = null;
    this.currentDate = null;
    this.logger = null;
    
    // 确保日志目录存在
    this.ensureLogDir();
    
    // 初始化日志
    this.initializeLogger();
    
    // 启动时清理过期日志
    this.cleanupOldLogs();
    
    // 每小时检查一次是否需要轮转日志
    setInterval(() => {
      this.checkLogRotation();
    }, 60 * 60 * 1000); // 1小时
    
    // 每天清理一次过期日志
    setInterval(() => {
      this.cleanupOldLogs();
    }, 24 * 60 * 60 * 1000); // 24小时
  }
  
  /**
   * 确保日志目录存在
   */
  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
      console.log(`📁 创建日志目录: ${this.logDir}`);
    }
  }
  
  /**
   * 获取当前日期字符串
   */
  getDateString() {
    return new Date().toISOString().split('T')[0];
  }
  
  /**
   * 生成日志文件路径
   */
  getLogFilePath(date = null) {
    const dateStr = date || this.getDateString();
    const ext = path.extname(this.baseLogFile);
    const name = path.basename(this.baseLogFile, ext);
    return path.join(this.logDir, `${name}-${dateStr}${ext}`);
  }
  
  /**
   * 初始化日志器
   */
  initializeLogger() {
    const currentDate = this.getDateString();
    const logFilePath = this.getLogFilePath(currentDate);
    
    this.currentDate = currentDate;
    this.currentLogFile = logFilePath;
    
    console.log(`📝 日志文件: ${logFilePath}`);
    
    // 创建pino流到当前日志文件
    this.createLogStream();
  }
  
  /**
   * 创建日志流
   */
  createLogStream() {
    if (this.logger) {
      // 关闭现有的日志流
      this.logger.flush();
    }
    
    const logStream = pino.destination({
      dest: this.currentLogFile,
      sync: false,
      mkdir: true
    });
    
    // 创建子日志器用于文件输出
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => {
          return { level: label };
        }
      }
    }, logStream);
  }
  
  /**
   * 检查是否需要轮转日志
   */
  checkLogRotation() {
    const currentDate = this.getDateString();
    
    if (currentDate !== this.currentDate) {
      console.log(`🔄 日志轮转: ${this.currentDate} -> ${currentDate}`);
      
      this.currentDate = currentDate;
      this.currentLogFile = this.getLogFilePath(currentDate);
      
      // 重新创建日志流
      this.createLogStream();
      
      console.log(`📝 新日志文件: ${this.currentLogFile}`);
    }
  }
  
  /**
   * 清理过期日志
   */
  cleanupOldLogs() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      
      if (!fs.existsSync(this.logDir)) {
        return;
      }
      
      const logFiles = fs.readdirSync(this.logDir).filter(file => {
        return file.match(/app-\d{4}-\d{2}-\d{2}\.log$/);
      });
      
      let cleanedCount = 0;
      
      logFiles.forEach(file => {
        const match = file.match(/app-(\d{4}-\d{2}-\d{2})\.log/);
        if (match) {
          const fileDate = new Date(match[1]);
          if (fileDate < cutoffDate) {
            const filePath = path.join(this.logDir, file);
            try {
              fs.unlinkSync(filePath);
              cleanedCount++;
              console.log(`🗑️ 已清理过期日志: ${file}`);
            } catch (error) {
              console.error(`删除日志文件失败 ${file}:`, error.message);
            }
          }
        }
      });
      
      if (cleanedCount > 0) {
        console.log(`✅ 清理完成，删除了 ${cleanedCount} 个过期日志文件`);
      }
      
    } catch (error) {
      console.error('清理过期日志失败:', error.message);
    }
  }
  
  /**
   * 写入日志
   */
  write(level, message, extra = {}) {
    // 检查是否需要轮转
    this.checkLogRotation();
    
    if (this.logger) {
      this.logger[level](extra, message);
    }
  }
  
  /**
   * 获取日志统计信息
   */
  getLogStats() {
    try {
      const logFiles = fs.readdirSync(this.logDir).filter(file => {
        return file.match(/app-\d{4}-\d{2}-\d{2}\.log$/);
      });
      
      const stats = {
        totalFiles: logFiles.length,
        files: [],
        totalSize: 0,
        retentionDays: this.retentionDays,
        currentLogFile: this.currentLogFile
      };
      
      logFiles.forEach(file => {
        const filePath = path.join(this.logDir, file);
        const fileStat = fs.statSync(filePath);
        const fileInfo = {
          name: file,
          size: fileStat.size,
          sizeFormatted: this.formatBytes(fileStat.size),
          created: fileStat.birthtime,
          modified: fileStat.mtime
        };
        stats.files.push(fileInfo);
        stats.totalSize += fileStat.size;
      });
      
      stats.totalSizeFormatted = this.formatBytes(stats.totalSize);
      stats.files.sort((a, b) => b.modified - a.modified); // 按修改时间倒序
      
      return stats;
    } catch (error) {
      console.error('获取日志统计失败:', error.message);
      return {
        totalFiles: 0,
        files: [],
        totalSize: 0,
        error: error.message
      };
    }
  }
  
  /**
   * 格式化文件大小
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * 手动触发日志清理
   */
  manualCleanup() {
    console.log('🔧 手动触发日志清理...');
    this.cleanupOldLogs();
  }
  
  /**
   * 手动触发日志轮转
   */
  manualRotation() {
    console.log('🔧 手动触发日志轮转...');
    this.checkLogRotation();
  }
  
  /**
   * 关闭日志管理器
   */
  close() {
    if (this.logger) {
      this.logger.flush();
    }
  }
}

// 创建单例实例
const logManager = new LogManager();

module.exports = logManager; 