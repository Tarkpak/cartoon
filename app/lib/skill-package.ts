const MAX_PACKAGE_BYTES = 1024 * 1024

/** Upload only explicitly selected files; no local filesystem paths reach the server. */
export async function readSkillDirectory(files: File[]): Promise<{ files: Record<string, string> }> {
  files = files.filter(file => !(file.webkitRelativePath || file.name).split('/').some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._')))
  if (!files.length || files.length > 128) throw new Error('请选择包含 SKILL.md 的目录，最多 128 个文件')
  if (files.reduce((size, file) => size + file.size, 0) > MAX_PACKAGE_BYTES) {
    throw new Error('技能文本和附件合计不能超过 1 MB')
  }
  const result: Record<string, string> = Object.create(null)
  for (const file of files) {
    const path = file.webkitRelativePath || file.name
    if (file.size > 256 * 1024) throw new Error(`文件 ${path} 超过单文件上限 256 KB`)
    if (path.split('/').some(part => !part || part === '..' || part === '.') || /[\\:\0]/.test(path)) {
      throw new Error('技能文件路径无效')
    }
    if (Object.hasOwn(result, path)) throw new Error('技能包含重复文件路径')
    try {
      result[path] = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    } catch {
      throw new Error(`文件 ${path} 不是可读取的 UTF-8 文本`)
    }
  }
  return { files: result }
}

export async function readSkillZip(file: File): Promise<{ zip: string }> {
  if (file.size > 1024 * 1024) throw new Error('ZIP 不能超过 1 MB，解压后文本合计不能超过 1 MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { zip: btoa(binary) }
}
