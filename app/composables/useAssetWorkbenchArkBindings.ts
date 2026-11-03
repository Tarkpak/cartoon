import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useToast } from '~/composables/useToast'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import type { ArkVirtualAssetBinding } from '~/lib/asset-workbench-types'
import { getArkCredentialContext, getArkVirtualAsset } from '~/lib/ark-virtual-assets'

/**
 * Ark virtual-asset bindings are tied to the Volcengine account that created
 * them. After the project loads (and whenever the window regains focus), check
 * bindings made under another account and mark the unreachable ones as stale.
 */
export function useAssetWorkbenchArkBindings(options: {
  characters: Ref<CharacterData[]>
  loading: Ref<boolean>
  projectId: Ref<string | undefined>
  saveProject: () => Promise<unknown>
}) {
  const { characters, loading, projectId, saveProject } = options
  const { toast } = useToast()

  const lastArkBindingReconcileKey = ref('')

  function buildArkBindingReconcileKey(project: string, credentialFingerprint: string) {
    const bindingSignature = characters.value
      .map(character => character.arkAsset)
      .filter(binding => !!binding?.assetId)
      .map(binding => `${binding?.assetId}:${binding?.credentialFingerprint || 'legacy'}:${binding?.status}`)
      .sort()
      .join('|')
    return `${project}:${credentialFingerprint}:${bindingSignature}`
  }

  async function reconcileArkBindingsForCurrentAccount() {
    const currentProjectId = projectId.value
    if (loading.value || !currentProjectId) return

    const bindings = characters.value
      .map(character => ({ character, binding: character.arkAsset }))
      .filter(item => !!item.binding?.assetId)
    if (bindings.length === 0) return

    let credentialFingerprint: string | undefined
    try {
      credentialFingerprint = (await getArkCredentialContext()).credentialFingerprint
    } catch (error) {
      console.warn('[asset-workbench] 读取 Ark 凭证上下文失败:', error)
      return
    }
    if (!credentialFingerprint) return

    const reconcileKey = buildArkBindingReconcileKey(currentProjectId, credentialFingerprint)
    if (lastArkBindingReconcileKey.value === reconcileKey) return
    lastArkBindingReconcileKey.value = reconcileKey

    const checks = new Map<string, Promise<ArkVirtualAssetBinding>>()
    let changed = false
    let staleCount = 0

    await Promise.all(bindings.map(async ({ character, binding }) => {
      if (!binding?.assetId) return
      if (binding.credentialFingerprint === credentialFingerprint && binding.status !== 'Stale') return

      const checkKey = `${binding.projectName}:${binding.assetId}`
      let check = checks.get(checkKey)
      if (!check) {
        check = getArkVirtualAsset({
          assetId: binding.assetId,
          projectName: binding.projectName,
          fallback: binding
        })
        checks.set(checkKey, check)
      }

      try {
        character.arkAsset = await check
        changed = true
      } catch {
        character.arkAsset = {
          ...binding,
          status: 'Stale',
          errorMessage: '当前火山账号无法访问此素材，请重新入库或选择新账号下的素材。',
          updatedAt: new Date().toISOString()
        }
        staleCount += 1
        changed = true
      }
    }))

    if (changed) {
      await saveProject().catch(error => {
        console.warn('[asset-workbench] 保存 Ark 素材账号检查结果失败:', error)
      })
    }
    lastArkBindingReconcileKey.value = buildArkBindingReconcileKey(
      currentProjectId,
      credentialFingerprint
    )
    if (staleCount > 0) {
      toast.warning(`检测到 ${staleCount} 个旧账号素材`, {
        description: '旧 asset ID 已停止用于生成；请在角色资产中重新入库或选择新素材。'
      })
    }
  }

  watch(
    [loading, projectId],
    () => {
      if (!loading.value) void reconcileArkBindingsForCurrentAccount()
    },
    { flush: 'post' }
  )

  function handleArkAccountWindowFocus() {
    void reconcileArkBindingsForCurrentAccount()
  }

  onMounted(() => window.addEventListener('focus', handleArkAccountWindowFocus))

  onBeforeUnmount(() => window.removeEventListener('focus', handleArkAccountWindowFocus))
}
