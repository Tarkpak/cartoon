import { describe, expect, it } from 'vitest'
import type { DisplayAsset } from './asset-workbench-types'
import {
  buildSceneAssetMentionCandidates,
  mergeSceneEditAssetReferenceOptions,
  normalizeSceneDescriptionMentionsForSave,
  restoreSceneDescriptionMentionsForEdit,
  resolveUploadedSceneAssetMentionTokens
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

  it('keeps newly uploaded assets mentionable before parent options sync back', () => {
    const uploadedAsset = createAsset({
      id: 'prop:prop_uploaded',
      name: '线索照片',
      type: 'other',
      referenceImage: 'photo.png'
    })

    const mergedOptions = mergeSceneEditAssetReferenceOptions([uploadedAsset], [])
    const uploadTokens = resolveUploadedSceneAssetMentionTokens({
      createdAssets: [uploadedAsset],
      assetReferenceOptions: []
    })

    expect(mergedOptions).toEqual([uploadedAsset])
    expect(uploadTokens).toEqual(['@线索照片'])

    const result = normalizeSceneDescriptionMentionsForSave({
      text: '镜头扫过桌上的 @线索照片 。',
      candidates: buildSceneAssetMentionCandidates(mergedOptions),
      selectedAssetReferenceIds: [uploadedAsset.id]
    })

    expect(result.assetIds).toEqual(['prop:prop_uploaded'])
    expect(result.description).toBe('镜头扫过桌上的 线索照片 。\n\n[引用资产]\n@线索照片')
  })

  it('restores selected asset names back to mention tokens when reopening editor', () => {
    const assets = [
      createAsset({
        id: 'prop:prop_uploaded',
        name: '线索照片',
        type: 'other',
        referenceImage: 'photo.png'
      }),
      createAsset({
        id: 'prop:prop_2',
        name: '桌面',
        type: 'prop'
      })
    ]

    const restored = restoreSceneDescriptionMentionsForEdit({
      text: '镜头扫过桌上的线索照片。',
      candidates: buildSceneAssetMentionCandidates(assets),
      selectedAssetReferenceIds: ['prop:prop_uploaded']
    })

    expect(restored).toBe('镜头扫过桌上的@线索照片。')
  })

  it('keeps mentioned assets before preselected-only assets when saving references', () => {
    const assets = [
      createAsset({
        id: 'prop:prop_1',
        name: '工作证',
        type: 'prop'
      }),
      createAsset({
        id: 'prop:prop_2',
        name: '手电筒',
        type: 'other'
      })
    ]

    const result = normalizeSceneDescriptionMentionsForSave({
      text: '主角亮出 @工作证。',
      candidates: buildSceneAssetMentionCandidates(assets),
      selectedAssetReferenceIds: ['prop:prop_2']
    })

    expect(result.assetIds).toEqual(['prop:prop_1', 'prop:prop_2'])
  })
})
