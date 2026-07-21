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

  it('normalizes known metadata and preserves open-ended creative values', () => {
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
        props: [
          { name: '白色大卡车', description: '车头逼近，喇叭刺耳' }
        ],
        dramatic: '现代悠闲摆烂氛围，为突发死亡制造反差。',
        shotType: '中景、近景、逆光环境镜头',
        cameraMovement: '逆光环境镜头',
        environmentCaptureMode: '暖橙夕阳、市井烟火、柔和手绘质感',
        narration: ['字幕：2026年 夏', { text: '黄昏老街路口。' }]
      }]
    })

    expect(scenes[0]?.dramatic).toBeUndefined()
    expect(scenes[0]?.props).toEqual([
      { name: '白色大卡车', description: '车头逼近，喇叭刺耳' }
    ])
    expect(scenes[0]?.shotType).toBe('中景')
    expect(scenes[0]?.cameraMovement).toBe('逆光环境镜头')
    expect(scenes[0]?.environmentCaptureMode).toBe('四视角')
    expect(scenes[0]?.narration).toBe('字幕：2026年 夏\n黄昏老街路口。')
  })

  it('keeps dramatic analysis labels out of saved scene descriptions', () => {
    const scenes = buildParsedScenes({
      scenes: [{
        id: 'scene_001',
        title: '摆烂摊贩的黄昏',
        description: [
          '戏剧冲突：陈泽的摆烂日常被突发死亡危机撕开。',
          '爽点/痛点：普通人刚说完安稳就被灾难碾来。',
          '情绪曲线：悠闲摆烂->瞬间警觉。',
          '反击或反转：平静生活被车头撞碎。',
          '结尾钩子：白色大卡车的喇叭压过一切。',
          '镜头设计：',
          '0-2秒：，中景，跟拍。陈泽推着烧烤三轮车穿过老街。',
          '2-5秒：，近景，缓慢推近。陈泽抬头，眼神突然僵住。'
        ].join('\n'),
        duration: 8,
        setting: {
          location: '现代都市老街路口',
          timeOfDay: '傍晚'
        },
        characters: ['陈泽']
      }]
    })

    expect(scenes[0]?.dramatic?.conflict).toBe('陈泽的摆烂日常被突发死亡危机撕开。')
    expect(scenes[0]?.dramatic?.cliffhanger).toBe('白色大卡车的喇叭压过一切。')
    expect(scenes[0]?.description).toContain('镜头设计：')
    expect(scenes[0]?.description).toContain('0-2秒：中景，跟拍。')
    expect(scenes[0]?.description).not.toContain('0-2秒：，')
    expect(scenes[0]?.description).not.toContain('戏剧冲突：')
    expect(scenes[0]?.description).not.toContain('爽点/痛点：')
    expect(scenes[0]?.description).not.toContain('结尾钩子：')
  })

  it('keeps model-authored creative classifications outside the common suggestions', () => {
    const scenes = buildParsedScenes({
      scenes: [{
        id: 'scene_open',
        title: '审讯室',
        description: '两人隔桌对峙，真相仍被遮蔽。',
        duration: 8,
        setting: {
          location: '审讯室',
          timeOfDay: '夜晚'
        },
        characters: [{ name: '林默', emotion: '强装镇定下的迟疑' }],
        shotType: '过肩双人构图',
        cameraMovement: '斯坦尼康贴身游移',
        dramatic: {
          function: '误导与信息遮蔽'
        }
      }]
    })

    expect(scenes[0]?.shotType).toBe('过肩双人构图')
    expect(scenes[0]?.cameraMovement).toBe('斯坦尼康贴身游移')
    expect(scenes[0]?.dramatic?.function).toBe('误导与信息遮蔽')
    expect(scenes[0]?.characters[0]?.emotion).toBe('强装镇定下的迟疑')
  })
})
