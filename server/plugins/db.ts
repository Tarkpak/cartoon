import { initDatabase } from '../db'
import { initializeSelectedModels } from '../utils/model-provider'

/**
 * Nitro 插件 - 初始化数据库
 */
export default defineNitroPlugin(async () => {
  console.log('[Plugin] 初始化数据库...')
  initDatabase()
  await initializeSelectedModels()
})
