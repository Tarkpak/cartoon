import templateDefinitions from '../../../src-tauri/assets/default-prompt-templates.json'

export async function loadBuiltinPromptTemplates(readAsset: (fileName: string) => Promise<unknown>) {
  return Promise.all(templateDefinitions.map(async template => {
    const fileName = template.contentFile.replace(/^default-prompts\//, '')
    const content = await readAsset(fileName)
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(`内置提示词缺失：${template.id}`)
    }
    return { templateKey: template.id, content }
  }))
}
