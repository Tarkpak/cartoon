import { initDatabase } from '../db'

/**
 * Nitro 插件 - 初始化数据库
 */
export default defineNitroPlugin(() => {
  console.log('[Plugin] 初始化数据库...')
  initDatabase()
})
