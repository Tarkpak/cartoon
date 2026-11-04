import type { InjectionKey, Ref } from 'vue'

// A cached workbench can update while detached from document. Teleport must keep
// the actual target node instead of looking up an ID that is temporarily absent.
export const assetWorkbenchToolbarTargetKey: InjectionKey<Ref<HTMLElement | null>> = Symbol('asset-workbench-toolbar')
