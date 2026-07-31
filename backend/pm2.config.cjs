const path = require('node:path')

const appName = process.env.PM2_APP_NAME || 'playlet-admin-backend'
const host = process.env.HOST || process.env.NITRO_HOST || '127.0.0.1'
const port = process.env.PLAYLET_ADMIN_PORT || '43200'
const dataDir = process.env.PLAYLET_ADMIN_DATA_DIR || path.join(__dirname, 'data')
const bunBin = process.env.BUN_BIN || 'bun'

module.exports = {
  apps: [
    {
      name: appName,
      cwd: __dirname,
      script: '.output/server/index.mjs',
      interpreter: bunBin,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY || '512M',
      env: {
        NODE_ENV: 'production',
        HOST: host,
        PORT: port,
        NITRO_HOST: host,
        NITRO_PORT: port,
        PLAYLET_ADMIN_PORT: port,
        PLAYLET_ADMIN_DATA_DIR: dataDir
      },
      time: true,
      out_file: process.env.PM2_OUT_LOG || path.join(__dirname, 'logs', `${appName}.out.log`),
      error_file: process.env.PM2_ERROR_LOG || path.join(__dirname, 'logs', `${appName}.error.log`),
      merge_logs: true
    }
  ]
}
