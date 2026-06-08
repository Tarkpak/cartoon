import { describe, expect, it } from 'vitest'
import { buildParsedCharacters, buildParsedScenes } from './asset-workbench-script-parsing'

describe('asset-workbench-script-parsing', () => {
  it('normalizes model scenes with string characters and speaker dialogues', () => {
    const scenes = buildParsedScenes({
      scenes: [{
        id: '1-1',
        episodeId: 'episode_001',
        episodeTitle: '第1集',
        episodeIndex: 1,
        title: '破败窝棚',
        description: '白叙醒来，江沉踹门而入。',
        duration: 8,
        setting: {
          location: '末日荒野·破败窝棚',
          timeOfDay: '日'
        },
        characters: ['白叙', '江沉'],
        dialogues: [
          {
            speaker: '江沉',
            text: '没打死啊？',
            emotion: '轻蔑'
          },
          {
            speaker: '旁白',
            text: '他必须先忍住。'
          }
        ]
      }]
    })

    expect(scenes[0]?.characters).toEqual([
      { name: '白叙' },
      { name: '江沉' }
    ])
    expect(scenes[0]?.description).toContain('江沉：没打死啊？')
    expect(scenes[0]?.narration).toBe('他必须先忍住。')

    const characters = buildParsedCharacters(undefined, scenes)
    expect(characters.map(character => character.name)).toEqual(['白叙', '江沉'])
  })

  it('sanitizes free-text model metadata before saving scenes', () => {
    const scenes = buildParsedScenes({
      scenes: [{
        id: 'scene_001',
        title: '黄昏老街',
        description: '近景掠过冒烟铁皮烤炉，镜头缓慢平移到中景陈泽骑车穿过老街。',
        duration: 8,
        setting: {
          location: '现代都市老街路口',
          timeOfDay: '黄昏'
        },
        characters: ['陈泽'],
        dramatic: '现代悠闲摆烂氛围，为突发死亡制造反差。',
        shotType: '中景、近景、逆光环境镜头',
        cameraMovement: '逆光环境镜头',
        environmentCaptureMode: '暖橙夕阳、市井烟火、柔和手绘质感',
        narration: ['字幕：2026年 夏', { text: '黄昏老街路口。' }]
      }]
    })

    expect(scenes[0]?.dramatic).toBeUndefined()
    expect(scenes[0]?.shotType).toBe('medium')
    expect(scenes[0]?.cameraMovement).toBe('static')
    expect(scenes[0]?.environmentCaptureMode).toBe('four_view')
    expect(scenes[0]?.narration).toBe('字幕：2026年 夏\n黄昏老街路口。')
  })
})
