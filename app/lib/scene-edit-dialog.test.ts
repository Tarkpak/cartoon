import { describe, expect, it } from 'vitest'
import type { DisplayAsset } from './asset-workbench-types'
import {
  buildSceneAssetMentionCandidates,
  normalizeSceneDescriptionMentionsForSave
} from './scene-edit-dialog'

function createAsset(input: DisplayAsset): DisplayAsset {
  return {
    ...input
  }
}

describe('scene description mention normalization', () => {
  it('persists editor mentions as readable text plus asset reference block', () => {
    const assets = [
      createAsset({
        id: 'char:char_1',
        name: '阿强',
        type: 'character',
        referenceImage: 'char.png'
      }),
      createAsset({
        id: 'env:scene_1',
        name: '医院走廊',
        type: 'environment',
        referenceImage: 'env.png'
      }),
      createAsset({
        id: 'prop:prop_1',
        name: '工作证',
        type: 'prop',
        referenceImage: 'prop.png'
      })
    ]

    const result = normalizeSceneDescriptionMentionsForSave({
      text: '@阿强 推门冲进 @医院走廊，胸前的 @工作证 被灯光晃了一下。',
      candidates: buildSceneAssetMentionCandidates(assets),
      selectedAssetReferenceIds: []
    })

    expect(result.assetIds).toEqual([
      'char:char_1',
      'env:scene_1',
      'prop:prop_1'
    ])
    expect(result.description).toBe(
      '阿强 推门冲进 医院走廊，胸前的 工作证 被灯光晃了一下。\n\n[引用资产]\n@阿强\n@医院走廊\n@工作证'
    )
  })

  it('keeps timeline descriptions clean while preserving referenced asset ids', () => {
    const assets = [
      createAsset({
        id: 'char:char_1',
        name: '阿强',
        type: 'character'
      }),
      createAsset({
        id: 'env:scene_1',
        name: '医院走廊',
        type: 'environment'
      })
    ]

    const result = normalizeSceneDescriptionMentionsForSave({
      text: '0-3s：@阿强 从画面左侧冲进 @医院走廊。',
      candidates: buildSceneAssetMentionCandidates(assets),
      selectedAssetReferenceIds: []
    })

    expect(result.assetIds).toEqual([
      'char:char_1',
      'env:scene_1'
    ])
    expect(result.description).toBe('0-3s：阿强 从画面左侧冲进 医院走廊。')
  })
})
