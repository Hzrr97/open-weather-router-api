#!/usr/bin/env node
'use strict';

require('dotenv').config();
const ConfigValidator = require('../src/utils/configValidator');

function showUsage() {
  console.log(`
使用方法: node config-check.js [命令]

命令:
  validate    验证当前配置
  recommend   获取推荐配置
  help        显示帮助信息

示例:
  node config-check.js validate
  node config-check.js recommend --qps 5000
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'validate':
    case undefined:
      ConfigValidator.printValidationResult();
      break;
    case 'help':
    case '--help':
    case '-h':
      showUsage();
      break;

    default:
      console.error(`❌ 未知命令: ${command}`);
      showUsage();
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ConfigValidator }; 