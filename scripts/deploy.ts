#!/usr/bin/env bun
/**
 * 本地构建并部署到服务器
 * 用法: bun scripts/deploy.ts
 */

import { $ } from 'bun'

// ========== 配置 ==========
const config = {
  host: process.env.DEPLOY_HOST || '124.222.189.176',
  user: process.env.DEPLOY_USER || 'root',
  port: process.env.DEPLOY_PORT || '22',
  path: process.env.DEPLOY_PATH || '~/project/cartoon',
  key: process.env.SSH_KEY || '~/.ssh/oaks.pem',
}

const ssh = `ssh -p ${config.port} -i ${config.key} ${config.user}@${config.host}`
const scp = `scp -P ${config.port} -i ${config.key}`

// ========== 工具函数 ==========
const log = {
  info: (msg: string) => console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`),
  error: (msg: string) => { console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`); process.exit(1) },
}

// ========== 主流程 ==========
async function main() {
  if (!config.host) {
    log.error('请设置 DEPLOY_HOST 环境变量，例如: export DEPLOY_HOST=your-server.com')
  }

  // 本地构建
  log.info('开始本地构建...')
  await $`bun run build`

  // 打包
  log.info('打包构建产物...')
  await $`tar -czf deploy.tar.gz -C .output .`

  // 上传
  log.info(`上传到服务器 ${config.user}@${config.host}:${config.path}...`)
  await $`${scp.split(' ')} deploy.tar.gz package.json bun.lock ${config.user}@${config.host}:/tmp/`

  // 远程部署
  log.info('执行远程部署...')
  const remoteScript = `
    cd ${config.path}
    
    # 备份数据目录
    mv data /tmp/manju_data_backup 2>/dev/null || true
    mv public /tmp/manju_public_backup 2>/dev/null || true
    mv ecosystem.config.cjs /tmp/manju_ecosystem_backup 2>/dev/null || true
    
    # 清理并解压
    rm -rf *
    tar -xzf /tmp/deploy.tar.gz
    cp /tmp/package.json /tmp/bun.lock .
    
    # 恢复备份
    mv /tmp/manju_ecosystem_backup ecosystem.config.cjs 2>/dev/null || true
    mv /tmp/manju_data_backup data 2>/dev/null || mkdir -p data
    mv /tmp/manju_public_backup public 2>/dev/null || mkdir -p public
    
    # 检查依赖是否需要更新
    if [ -f .bun.lock.md5 ] && md5sum -c .bun.lock.md5 --status 2>/dev/null; then
      echo '依赖未变化，跳过安装'
    else
      echo '依赖有变化，重新安装 better-sqlite3'
      source ~/.bashrc
      cd server && rm -rf node_modules/better-sqlite3 && npm install better-sqlite3
      cd ..
      md5sum bun.lock > .bun.lock.md5
    fi
    
    # 清理临时文件
    rm -f /tmp/deploy.tar.gz /tmp/package.json /tmp/bun.lock
    
    # 重启服务
    source ~/.bashrc
    pm2 delete manju 2>/dev/null || true
    pm2 start ecosystem.config.cjs
    
    echo '部署完成!'
  `
  await $`${ssh.split(' ')} ${remoteScript}`

  // 清理本地
  await $`rm -f deploy.tar.gz`
  log.info('部署成功! ✨')
}

main().catch(e => log.error(e.message))
