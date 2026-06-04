import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const stylesDir = join(process.cwd(), '.output', 'public', 'styles')

if (existsSync(stylesDir)) {
  rmSync(stylesDir, { recursive: true, force: true })
  console.log(`[desktop-build] removed bundled style thumbnails: ${stylesDir}`)
} else {
  console.log(`[desktop-build] no bundled style thumbnails found: ${stylesDir}`)
}
