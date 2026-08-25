<script setup lang="ts">
import {
  Archive,
  Check,
  ChevronsUpDown,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  FileAudio,
  FileImage,
  History,
  ListChecks,
  Loader2,
  MicVocal,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Square,
  Sparkles,
  Upload,
  UserRound
} from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import {
  activateVoiceProfile,
  archiveVoiceProfile,
  cloneVoice,
  createVoiceGeneration,
  fileToDataUrl,
  getVoiceHealth,
  getVoicePresetPreview,
  listVoiceGenerations,
  listVoiceProfiles,
  refreshVoiceProfile,
  retryVoiceGeneration
} from '@/lib/voice-api'
import type { VoiceGenerationTask, VoiceHealth, VoiceProfile } from '#shared/types/voice'
import {
  VOLCENGINE_VOICE_PRESETS,
  type VolcengineVoicePreset
} from '#shared/types/volcengine-voice-presets.generated'

definePageMeta({ layout: 'default' })

type View = 'generate' | 'clone' | 'tasks'
type GenerationMode = 'preset' | 'prompt' | 'reference_audio' | 'reference_image' | 'profile'

interface ReferenceFile {
  file: File
  data: string
  previewUrl: string
  kind: 'audio' | 'image'
}

interface VoiceWorkbenchPreferences {
  generationMode: GenerationMode
  speakerId: string
  scene: string
  gender: string
  category: string
  sampleRate: string
  speechRate: number
  loudnessRate: number
  pitchRate: number
  enableSubtitle: boolean
  showAdvanced: boolean
}

const VOICE_WORKBENCH_PREFERENCES_KEY = 'playlet:voice-workbench:preferences:v1'
const VOICE_BILLING_DOC_URL = 'https://www.volcengine.com/docs/6561/1359370'

const { toast } = useToast()
const { confirm } = useConfirm()
const activeView = ref<View>('generate')
const health = ref<VoiceHealth | null>(null)
const profiles = ref<VoiceProfile[]>([])
const tasks = ref<VoiceGenerationTask[]>([])
const loading = ref(true)
const loadError = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

const generationMode = ref<GenerationMode>('preset')
const generationName = ref('')
const generationPrompt = ref('')
const generationCategory = ref('narration')
const selectedPresetSpeakerId = ref('zh_female_vv_uranus_bigtts')
const presetVoiceSearch = ref('Vivi 2.0')
const presetVoiceScene = ref('all')
const presetVoiceGender = ref('all')
const presetVoiceComboboxOpen = ref(false)
const presetVoiceComboboxRef = ref<HTMLElement | null>(null)
const highlightedPresetVoiceIndex = ref(0)
const previewLoadingSpeakerId = ref('')
const previewPlayingSpeakerId = ref('')
const previewAudioUrls = new Map<string, string>()
let presetPreviewAudio: HTMLAudioElement | null = null
let presetPreviewRequestId = 0
const selectedProfileId = ref('')
const references = ref<ReferenceFile[]>([])
const referenceInput = ref<HTMLInputElement | null>(null)
const generating = ref(false)
const generationError = ref('')
const showAdvanced = ref(false)
const sampleRate = ref('24000')
const speechRate = ref(0)
const loudnessRate = ref(0)
const pitchRate = ref(0)
const enableSubtitle = ref(true)

const cloneName = ref('')
const cloneFile = ref<File | null>(null)
const cloneAudioData = ref('')
const clonePreviewUrl = ref('')
const cloneReferenceText = ref('')
const cloneDemoText = ref('你好，很高兴认识你。这是我的声音。')
const cloneLanguage = ref('0')
const enableAudioDenoise = ref(false)
const disableVolumeNormalization = ref(false)
const consentConfirmed = ref(false)
const cloning = ref(false)
const cloneError = ref('')
const recording = ref(false)
const recordingSeconds = ref(0)
let recordingTimer: ReturnType<typeof setInterval> | null = null
let mediaRecorder: MediaRecorder | null = null
let recordingStream: MediaStream | null = null
let recordingChunks: Blob[] = []
const refreshingProfileId = ref('')
const activatingProfileId = ref('')

async function openVoiceBillingDoc() {
  try {
    const runtime = window as typeof window & {
      __TAURI__?: unknown
      __TAURI_INTERNALS__?: unknown
    }
    if (runtime.__TAURI__ || runtime.__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('open_external_url', { url: VOICE_BILLING_DOC_URL })
      return
    }

    const opened = window.open(VOICE_BILLING_DOC_URL, '_blank', 'noopener,noreferrer')
    if (!opened) throw new Error('浏览器阻止了新窗口')
  } catch (error) {
    toast.error('无法打开计费说明', { description: readableError(error) })
  }
}

const modeOptions: Array<{ value: GenerationMode, label: string, icon: typeof Sparkles }> = [
  { value: 'preset', label: '官方音色', icon: UserRound },
  { value: 'profile', label: '我的音色', icon: MicVocal },
  { value: 'prompt', label: '自由生成', icon: Sparkles },
  { value: 'reference_audio', label: '临时参考音频', icon: FileAudio },
  { value: 'reference_image', label: '参考图片', icon: FileImage }
]

const viewOptions: Array<{ value: View, label: string, icon: typeof Sparkles }> = [
  { value: 'generate', label: '声音生成', icon: Sparkles },
  { value: 'clone', label: '我的音色', icon: MicVocal },
  { value: 'tasks', label: '任务记录', icon: ListChecks }
]

const chinesePresetVoices = VOLCENGINE_VOICE_PRESETS.filter(voice => voice.locale === 'zh')

const presetVoiceSceneOptions = [...new Set(chinesePresetVoices.flatMap(voice =>
  voice.scene.split(/[,，]/).map(scene => scene.trim()).filter(Boolean)
))].sort((left, right) => left.localeCompare(right, 'zh-CN'))

const filteredPresetVoiceOptions = computed(() => {
  const keyword = presetVoiceComboboxOpen.value
    ? presetVoiceSearch.value.trim().toLocaleLowerCase()
    : ''
  return chinesePresetVoices.filter((voice) => {
    if (presetVoiceScene.value !== 'all' && !voice.scene.split(/[,，]/).map(value => value.trim()).includes(presetVoiceScene.value)) return false
    if (presetVoiceGender.value !== 'all' && voice.gender !== presetVoiceGender.value) return false
    if (!keyword) return true
    return [voice.name, voice.id, voice.scene, voice.language, voice.capability, voice.tags]
      .some(value => value.toLocaleLowerCase().includes(keyword))
  })
})

const selectedPresetVoice = computed(() =>
  chinesePresetVoices.find(voice => voice.id === selectedPresetSpeakerId.value)
)

const activeTasks = computed(() => tasks.value.filter(task => task.status === 'queued' || task.status === 'generating'))
const usableProfiles = computed(() => profiles.value.filter(profile =>
  (profile.status === 'ready' || profile.status === 'active') && !!profile.activatedAt
))
const referenceAccept = computed(() => generationMode.value === 'reference_image' ? 'image/jpeg,image/png,image/webp' : 'audio/*')

function restoreVoiceWorkbenchPreferences() {
  try {
    const raw = window.localStorage.getItem(VOICE_WORKBENCH_PREFERENCES_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as Partial<VoiceWorkbenchPreferences>
    if (modeOptions.some(option => option.value === saved.generationMode)) generationMode.value = saved.generationMode!
    const savedVoice = chinesePresetVoices.find(voice => voice.id === saved.speakerId)
    if (savedVoice) {
      selectedPresetSpeakerId.value = savedVoice.id
      presetVoiceSearch.value = savedVoice.name
    }
    if (saved.scene === 'all' || presetVoiceSceneOptions.includes(saved.scene || '')) presetVoiceScene.value = saved.scene!
    if (saved.gender === 'all' || saved.gender === 'female' || saved.gender === 'male') presetVoiceGender.value = saved.gender
    if (['narration', 'character_voice', 'sfx', 'bgm'].includes(saved.category || '')) generationCategory.value = saved.category!
    if (['16000', '24000', '44100', '48000'].includes(saved.sampleRate || '')) sampleRate.value = saved.sampleRate!
    if (typeof saved.speechRate === 'number' && saved.speechRate >= -50 && saved.speechRate <= 100) speechRate.value = saved.speechRate
    if (typeof saved.loudnessRate === 'number' && saved.loudnessRate >= -50 && saved.loudnessRate <= 100) loudnessRate.value = saved.loudnessRate
    if (typeof saved.pitchRate === 'number' && saved.pitchRate >= -50 && saved.pitchRate <= 100) pitchRate.value = saved.pitchRate
    if (typeof saved.enableSubtitle === 'boolean') enableSubtitle.value = saved.enableSubtitle
    if (typeof saved.showAdvanced === 'boolean') showAdvanced.value = saved.showAdvanced
  } catch {
    // Ignore malformed or unavailable local storage and keep safe defaults.
  }
}

function persistVoiceWorkbenchPreferences() {
  try {
    const preferences: VoiceWorkbenchPreferences = {
      generationMode: generationMode.value,
      speakerId: selectedPresetSpeakerId.value,
      scene: presetVoiceScene.value,
      gender: presetVoiceGender.value,
      category: generationCategory.value,
      sampleRate: sampleRate.value,
      speechRate: speechRate.value,
      loudnessRate: loudnessRate.value,
      pitchRate: pitchRate.value,
      enableSubtitle: enableSubtitle.value,
      showAdvanced: showAdvanced.value
    }
    window.localStorage.setItem(VOICE_WORKBENCH_PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // Ignore local storage write failures.
  }
}

function closePresetVoiceCombobox() {
  presetVoiceComboboxOpen.value = false
  presetVoiceSearch.value = selectedPresetVoice.value?.name || ''
}

function openPresetVoiceCombobox() {
  if (presetVoiceComboboxOpen.value) return
  presetVoiceSearch.value = ''
  presetVoiceComboboxOpen.value = true
  nextTick(() => {
    highlightedPresetVoiceIndex.value = Math.max(
      0,
      filteredPresetVoiceOptions.value.findIndex(voice => voice.id === selectedPresetSpeakerId.value)
    )
    scrollToHighlightedPresetVoice()
  })
}

function selectPresetVoice(voice: VolcengineVoicePreset) {
  selectedPresetSpeakerId.value = voice.id
  presetVoiceSearch.value = voice.name
  presetVoiceComboboxOpen.value = false
}

function waitForPreview(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function playPresetVoicePreview(voice: VolcengineVoicePreset) {
  if (previewPlayingSpeakerId.value === voice.id && presetPreviewAudio) {
    presetPreviewAudio.pause()
    previewPlayingSpeakerId.value = ''
    return
  }

  presetPreviewAudio?.pause()
  previewPlayingSpeakerId.value = ''
  const requestId = ++presetPreviewRequestId
  previewLoadingSpeakerId.value = voice.id
  try {
    let audioUrl = previewAudioUrls.get(voice.id)
    for (let attempt = 0; !audioUrl && attempt < 45; attempt += 1) {
      const preview = await getVoicePresetPreview(voice.id)
      if (requestId !== presetPreviewRequestId) return
      if (preview.status === 'ready') {
        audioUrl = preview.audioUrl
        previewAudioUrls.set(voice.id, audioUrl)
        break
      }
      await waitForPreview(preview.retryAfterMs)
    }
    if (!audioUrl) throw new Error('试听生成时间较长，请稍后重试')
    if (!presetPreviewAudio) {
      presetPreviewAudio = new Audio()
      presetPreviewAudio.preload = 'auto'
      presetPreviewAudio.addEventListener('ended', () => {
        previewPlayingSpeakerId.value = ''
      })
      presetPreviewAudio.addEventListener('pause', () => {
        if (!presetPreviewAudio?.ended) previewPlayingSpeakerId.value = ''
      })
    }
    presetPreviewAudio.pause()
    presetPreviewAudio.src = audioUrl
    await presetPreviewAudio.play()
    if (requestId === presetPreviewRequestId) previewPlayingSpeakerId.value = voice.id
  } catch (error) {
    if (requestId === presetPreviewRequestId) {
      toast.error('音色试听失败', { description: readableError(error) })
    }
  } finally {
    if (requestId === presetPreviewRequestId) previewLoadingSpeakerId.value = ''
  }
}

function scrollToHighlightedPresetVoice() {
  nextTick(() => {
    document.getElementById(`preset-voice-${filteredPresetVoiceOptions.value[highlightedPresetVoiceIndex.value]?.id}`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function moveHighlightedPresetVoice(offset: number) {
  if (!presetVoiceComboboxOpen.value) openPresetVoiceCombobox()
  const count = filteredPresetVoiceOptions.value.length
  if (count === 0) return
  highlightedPresetVoiceIndex.value = (highlightedPresetVoiceIndex.value + offset + count) % count
  scrollToHighlightedPresetVoice()
}

function handlePresetVoiceKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlightedPresetVoice(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlightedPresetVoice(-1)
  } else if (event.key === 'Enter' && presetVoiceComboboxOpen.value) {
    event.preventDefault()
    const voice = filteredPresetVoiceOptions.value[highlightedPresetVoiceIndex.value]
    if (voice) selectPresetVoice(voice)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closePresetVoiceCombobox()
  } else if (event.key === 'Tab') {
    closePresetVoiceCombobox()
  }
}

watch([presetVoiceSearch, presetVoiceScene, presetVoiceGender], () => {
  highlightedPresetVoiceIndex.value = 0
})

watch([
  generationMode,
  selectedPresetSpeakerId,
  presetVoiceScene,
  presetVoiceGender,
  generationCategory,
  sampleRate,
  speechRate,
  loudnessRate,
  pitchRate,
  enableSubtitle,
  showAdvanced
], persistVoiceWorkbenchPreferences, { flush: 'post' })

onClickOutside(presetVoiceComboboxRef, closePresetVoiceCombobox)

function readableError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(value?: number): string {
  if (!value) return '--'
  return `${(value / 1000).toFixed(1)} 秒`
}

function taskStatusLabel(status: VoiceGenerationTask['status']): string {
  return { queued: '排队中', generating: '生成中', completed: '已完成', failed: '失败' }[status]
}

function profileStatusLabel(profile: VoiceProfile): string {
  if ((profile.status === 'ready' || profile.status === 'active') && !profile.activatedAt) return '待启用'
  return { not_found: '未找到', training: '训练中', ready: '可使用', failed: '失败', active: '已启用' }[profile.status]
}

function statusClass(status: string): string {
  if (status === 'completed' || status === 'ready' || status === 'active') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'failed' || status === 'not_found') return 'bg-destructive/10 text-destructive'
  return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function profileStatusClass(profile: VoiceProfile): string {
  return statusClass((profile.status === 'ready' || profile.status === 'active') && !profile.activatedAt ? 'pending' : profile.status)
}

async function loadData(silent = false) {
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    const [nextHealth, nextProfiles, nextTasks] = await Promise.all([
      getVoiceHealth(),
      listVoiceProfiles(),
      listVoiceGenerations()
    ])
    health.value = nextHealth
    profiles.value = nextProfiles
    tasks.value = nextTasks
    if (!selectedProfileId.value && usableProfiles.value[0]) selectedProfileId.value = usableProfiles.value[0].id
  } catch (error) {
    loadError.value = readableError(error)
  } finally {
    loading.value = false
  }
}

function clearReferences() {
  references.value.forEach(item => URL.revokeObjectURL(item.previewUrl))
  references.value = []
  if (referenceInput.value) referenceInput.value.value = ''
}

watch(generationMode, () => {
  clearReferences()
  generationError.value = ''
})

async function handleReferenceFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  const maxFiles = generationMode.value === 'reference_image' ? 1 : 3
  if (files.length > maxFiles) {
    generationError.value = generationMode.value === 'reference_image' ? '只能选择一张参考图片' : '最多选择三段参考音频'
    return
  }
  if (files.some(file => file.size > 10 * 1024 * 1024)) {
    generationError.value = '单个参考文件不能超过 10 MB'
    return
  }
  clearReferences()
  references.value = await Promise.all(files.map(async file => ({
    file,
    data: await fileToDataUrl(file),
    previewUrl: URL.createObjectURL(file),
    kind: generationMode.value === 'reference_image' ? 'image' : 'audio'
  })))
}

async function submitGeneration() {
  generationError.value = ''
  if (!generationPrompt.value.trim()) {
    generationError.value = '请输入要生成的文本或声音描述'
    return
  }
  if ((generationMode.value === 'reference_audio' || generationMode.value === 'reference_image') && references.value.length === 0) {
    generationError.value = '请选择参考文件'
    return
  }
  if (generationMode.value === 'profile' && !selectedProfileId.value) {
    generationError.value = '请选择复刻音色'
    return
  }
  if (generationMode.value === 'preset' && !selectedPresetSpeakerId.value) {
    generationError.value = '请选择官方音色'
    return
  }
  generating.value = true
  try {
    const task = await createVoiceGeneration({
      mode: generationMode.value,
      name: generationName.value.trim() || undefined,
      prompt: generationPrompt.value.trim(),
      category: generationCategory.value,
      speakerId: generationMode.value === 'preset' ? selectedPresetSpeakerId.value : undefined,
      voiceProfileId: generationMode.value === 'profile' ? selectedProfileId.value : undefined,
      references: references.value.map(item => ({ data: item.data })),
      format: 'mp3',
      sampleRate: Number(sampleRate.value),
      speechRate: speechRate.value,
      loudnessRate: loudnessRate.value,
      pitchRate: pitchRate.value,
      enableSubtitle: enableSubtitle.value
    })
    tasks.value.unshift(task)
    generationName.value = ''
    generationPrompt.value = ''
    clearReferences()
    toast.success('任务已提交', { description: '完成后会自动保存到个人资源库。' })
    activeView.value = 'tasks'
  } catch (error) {
    generationError.value = readableError(error)
  } finally {
    generating.value = false
  }
}

async function handleCloneFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  cloneError.value = ''
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    cloneError.value = '声音样本不能超过 10 MB'
    input.value = ''
    return
  }
  if (clonePreviewUrl.value) URL.revokeObjectURL(clonePreviewUrl.value)
  cloneFile.value = file
  cloneAudioData.value = await fileToDataUrl(file)
  clonePreviewUrl.value = URL.createObjectURL(file)
  if (!cloneName.value) cloneName.value = file.name.replace(/\.[^.]+$/, '')
}

function stopRecordingStream() {
  recordingStream?.getTracks().forEach(track => track.stop())
  recordingStream = null
  if (recordingTimer) clearInterval(recordingTimer)
  recordingTimer = null
}

function recordingLabel(): string {
  const minutes = Math.floor(recordingSeconds.value / 60).toString().padStart(2, '0')
  const seconds = (recordingSeconds.value % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

async function useCloneAudioBlob(blob: Blob) {
  if (blob.size > 10 * 1024 * 1024) {
    cloneError.value = '录音超过 10 MB，请缩短录制时间'
    return
  }
  const mimeType = blob.type || 'audio/webm'
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'
  const file = new File([blob], `麦克风录音-${Date.now()}.${extension}`, { type: mimeType })
  if (clonePreviewUrl.value) URL.revokeObjectURL(clonePreviewUrl.value)
  cloneFile.value = file
  cloneAudioData.value = await fileToDataUrl(file)
  clonePreviewUrl.value = URL.createObjectURL(file)
  if (!cloneName.value) cloneName.value = '我的音色'
}

async function startRecording() {
  cloneError.value = ''
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    cloneError.value = '当前环境不支持麦克风录音，请改为上传音频文件'
    return
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const preferredType = ['audio/mp4', 'audio/ogg;codecs=opus']
      .find(type => MediaRecorder.isTypeSupported(type))
    if (!preferredType) {
      stopRecordingStream()
      cloneError.value = '当前浏览器无法录制兼容格式，请改为上传 MP3、WAV、M4A 或 OGG 音频'
      return
    }
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType: preferredType })
    recordingChunks = []
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordingChunks.push(event.data)
    })
    mediaRecorder.addEventListener('stop', () => {
      const blob = new Blob(recordingChunks, { type: mediaRecorder?.mimeType || preferredType || 'audio/webm' })
      recording.value = false
      stopRecordingStream()
      if (blob.size > 0) void useCloneAudioBlob(blob)
    }, { once: true })
    mediaRecorder.start(1000)
    recordingSeconds.value = 0
    recording.value = true
    recordingTimer = setInterval(() => {
      recordingSeconds.value += 1
      if (recordingSeconds.value >= 60) stopRecording()
    }, 1000)
  } catch (error) {
    stopRecordingStream()
    cloneError.value = error instanceof DOMException && error.name === 'NotAllowedError'
      ? '没有麦克风权限，请在系统设置中允许访问后重试'
      : readableError(error)
  }
}

function stopRecording() {
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
}

async function submitClone() {
  cloneError.value = ''
  if (!cloneName.value.trim() || !cloneAudioData.value) {
    cloneError.value = '请填写音色名称并上传声音样本'
    return
  }
  if (!consentConfirmed.value) {
    cloneError.value = '请确认已获得声音使用授权'
    return
  }
  cloning.value = true
  try {
    const profile = await cloneVoice({
      name: cloneName.value.trim(),
      audioData: cloneAudioData.value,
      referenceText: cloneReferenceText.value.trim() || undefined,
      demoText: cloneDemoText.value.trim() || undefined,
      language: Number(cloneLanguage.value),
      enableAudioDenoise: enableAudioDenoise.value,
      disableVolumeNormalization: disableVolumeNormalization.value,
      consentConfirmed: consentConfirmed.value
    })
    profiles.value.unshift(profile)
    cloneName.value = ''
    cloneFile.value = null
    cloneAudioData.value = ''
    cloneReferenceText.value = ''
    consentConfirmed.value = false
    if (clonePreviewUrl.value) URL.revokeObjectURL(clonePreviewUrl.value)
    clonePreviewUrl.value = ''
    toast.success('音色训练已提交', { description: '训练完成后即可用于声音生成。' })
  } catch (error) {
    cloneError.value = readableError(error)
  } finally {
    cloning.value = false
  }
}

async function refreshProfile(profile: VoiceProfile) {
  refreshingProfileId.value = profile.id
  try {
    const next = await refreshVoiceProfile(profile.id)
    profiles.value = profiles.value.map(item => item.id === next.id ? next : item)
  } catch (error) {
    toast.error('状态刷新失败', { description: readableError(error) })
  } finally {
    refreshingProfileId.value = ''
  }
}

async function activateProfile(profile: VoiceProfile) {
  const accepted = await confirm({
    title: `支付 ¥138 并启用“${profile.name}”？`,
    description: '此操作会首次正式调用该复刻音色。火山引擎将收取后付费音色槽位费 ¥138/音色；生成内容另按语音合成用量计费。正式调用后音色会锁定，不能再次训练。价格以火山引擎控制台为准。',
    confirmText: '确认支付 ¥138 并启用'
  })
  if (!accepted) return
  activatingProfileId.value = profile.id
  try {
    const task = await activateVoiceProfile(profile.id)
    tasks.value.unshift(task)
    toast.success('音色启用任务已提交', { description: '成功后音色才会出现在声音生成的复刻音色列表中。' })
    activeView.value = 'tasks'
  } catch (error) {
    toast.error('音色启用失败', { description: readableError(error) })
  } finally {
    activatingProfileId.value = ''
  }
}

async function archiveProfile(profile: VoiceProfile) {
  const accepted = await confirm({
    title: '归档这个音色？',
    description: '只会从客户端音色列表隐藏，不会删除火山侧音色。',
    confirmText: '归档',
    variant: 'destructive'
  })
  if (!accepted) return
  await archiveVoiceProfile(profile.id)
  profiles.value = profiles.value.filter(item => item.id !== profile.id)
}

async function retryTask(task: VoiceGenerationTask) {
  try {
    const next = await retryVoiceGeneration(task.id)
    tasks.value = tasks.value.map(item => item.id === next.id ? next : item)
  } catch (error) {
    toast.error('重试失败', { description: readableError(error) })
  }
}

onMounted(() => {
  restoreVoiceWorkbenchPreferences()
  void loadData()
  pollTimer = setInterval(() => {
    if (activeTasks.value.length > 0 || profiles.value.some(profile => profile.status === 'training')) {
      void loadData(true)
    }
  }, 2500)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  clearReferences()
  if (clonePreviewUrl.value) URL.revokeObjectURL(clonePreviewUrl.value)
  presetPreviewRequestId += 1
  presetPreviewAudio?.pause()
  presetPreviewAudio = null
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
  stopRecordingStream()
})
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="声音工作台"
      description="使用官方音色或参考素材生成声音，并将结果直接沉淀到个人资源库。"
    >
      <template #actions>
        <div
          class="flex rounded-xl bg-muted/25 p-1"
          role="tablist"
          aria-label="声音工作台页面"
        >
          <button
            v-for="item in viewOptions"
            :key="item.value"
            type="button"
            role="tab"
            :aria-selected="activeView === item.value"
            class="inline-flex h-8 min-w-0 items-center rounded-sm px-3 text-sm font-medium text-muted-foreground transition-[color,background-color,box-shadow,transform] duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px"
            :class="activeView === item.value ? 'bg-background text-foreground shadow-sm' : ''"
            @click="activeView = item.value"
          >
            <component :is="item.icon" class="mr-2 h-4 w-4 shrink-0" />
            <span class="truncate">{{ item.label }}</span>
          </button>
        </div>
      </template>
    </AppPageHeader>

    <div
      v-if="activeView === 'generate'"
      class="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted/10 px-4 py-3 sm:px-6"
    >
      <span class="hidden text-xs font-medium text-muted-foreground sm:inline">生成方式</span>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-xl bg-muted/25 p-0.5 sm:flex-none" role="tablist" aria-label="声音生成方式">
        <button
          v-for="item in modeOptions"
          :key="item.value"
          type="button"
          role="tab"
          :aria-selected="generationMode === item.value"
          class="inline-flex h-8 min-w-0 items-center rounded-sm px-3 text-sm text-muted-foreground transition-[color,background-color,transform] duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
          :class="generationMode === item.value ? 'bg-accent font-medium text-foreground' : ''"
          @click="generationMode = item.value"
        >
          <component :is="item.icon" class="mr-2 h-4 w-4 shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </button>
      </div>
    </div>

    <AppPageContent scroll inner-class="w-full max-w-6xl space-y-5">
      <div
        v-if="health && !health.configured"
        class="flex flex-col gap-3 border border-amber-500/30 bg-amber-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-start gap-3">
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p class="text-sm font-medium">豆包语音尚未配置</p>
            <p class="mt-0.5 text-xs text-muted-foreground">请联系管理员在后台供应商管理中配置豆包语音 API Key。</p>
          </div>
        </div>
      </div>

      <div v-if="loading" class="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        加载声音工作台...
      </div>

      <div v-else-if="loadError" class="flex min-h-64 flex-col items-center justify-center gap-3 border border-dashed">
        <CircleAlert class="h-6 w-6 text-destructive" />
        <p class="text-sm text-destructive">{{ loadError }}</p>
        <Button size="sm" variant="outline" @click="loadData()">重新加载</Button>
      </div>

      <template v-else>
        <div v-if="activeView === 'generate'" class="w-full max-w-5xl">
          <section class="space-y-5 border bg-background p-5 shadow-sm">
            <div v-if="generationMode === 'preset'" class="space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label class="text-sm font-medium">官方音色</label>
                <span class="text-xs tabular-nums text-muted-foreground">{{ filteredPresetVoiceOptions.length }} / {{ chinesePresetVoices.length }} 个中文音色</span>
              </div>
              <div class="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_minmax(120px,1fr)]">
                <div ref="presetVoiceComboboxRef" class="relative min-w-0">
                  <Search class="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    v-model="presetVoiceSearch"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="preset-voice-options"
                    :aria-expanded="presetVoiceComboboxOpen"
                    :aria-activedescendant="presetVoiceComboboxOpen && filteredPresetVoiceOptions[highlightedPresetVoiceIndex] ? `preset-voice-${filteredPresetVoiceOptions[highlightedPresetVoiceIndex].id}` : undefined"
                    class="pr-9 pl-9"
                    placeholder="选择或搜索中文音色"
                    autocomplete="off"
                    @focus="openPresetVoiceCombobox"
                    @input="presetVoiceComboboxOpen = true"
                    @keydown="handlePresetVoiceKeydown"
                  />
                  <ChevronsUpDown class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <div
                    v-if="presetVoiceComboboxOpen"
                    id="preset-voice-options"
                    role="listbox"
                    class="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl bg-popover shadow-[0_16px_48px_hsl(var(--foreground)/0.14)] p-1 text-popover-foreground shadow-md"
                  >
                    <div
                      v-for="(voice, index) in filteredPresetVoiceOptions"
                      :key="voice.id"
                      class="flex min-h-11 w-full min-w-0 items-center gap-1 rounded-sm px-1 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                      :class="index === highlightedPresetVoiceIndex ? 'bg-accent text-accent-foreground' : ''"
                      @mouseenter="highlightedPresetVoiceIndex = index"
                    >
                      <button
                        :id="`preset-voice-${voice.id}`"
                        type="button"
                        role="option"
                        :aria-selected="voice.id === selectedPresetSpeakerId"
                        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-left"
                        @mousedown.prevent
                        @click="selectPresetVoice(voice)"
                      >
                        <span class="min-w-0 flex-1">
                          <span class="block truncate font-medium">{{ voice.name }}</span>
                          <span class="block truncate text-xs text-muted-foreground">{{ voice.scene }} · {{ voice.id }}</span>
                        </span>
                        <Check v-if="voice.id === selectedPresetSpeakerId" class="h-4 w-4 shrink-0" />
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-[color,background-color,transform] hover:bg-background hover:text-foreground active:scale-[0.96] disabled:cursor-wait disabled:opacity-70"
                        :disabled="previewLoadingSpeakerId === voice.id"
                        :title="previewPlayingSpeakerId === voice.id ? `暂停试听 ${voice.name}` : `试听 ${voice.name}`"
                        :aria-label="previewPlayingSpeakerId === voice.id ? `暂停试听 ${voice.name}` : `试听 ${voice.name}`"
                        @mousedown.stop.prevent
                        @click.stop="playPresetVoicePreview(voice)"
                      >
                        <Loader2 v-if="previewLoadingSpeakerId === voice.id" class="h-4 w-4 animate-spin" />
                        <Pause v-else-if="previewPlayingSpeakerId === voice.id" class="h-4 w-4" />
                        <Play v-else class="h-4 w-4 translate-x-px" />
                      </button>
                    </div>
                    <p v-if="filteredPresetVoiceOptions.length === 0" class="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的中文音色</p>
                  </div>
                </div>
                <Select v-model="presetVoiceScene">
                  <SelectTrigger><SelectValue placeholder="全部场景" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部场景</SelectItem>
                    <SelectItem v-for="scene in presetVoiceSceneOptions" :key="scene" :value="scene">{{ scene }}</SelectItem>
                  </SelectContent>
                </Select>
                <Select v-model="presetVoiceGender">
                  <SelectTrigger><SelectValue placeholder="全部声线" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部声线</SelectItem>
                    <SelectItem value="female">女声</SelectItem>
                    <SelectItem value="male">男声</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p v-if="filteredPresetVoiceOptions.length === 0" class="text-xs text-destructive">没有符合当前筛选条件的官方音色。</p>
              <p v-if="selectedPresetVoice" class="text-xs leading-5 text-muted-foreground">
                {{ selectedPresetVoice.scene }} · {{ selectedPresetVoice.language }}
                <span v-if="selectedPresetVoice.tags"> · {{ selectedPresetVoice.tags }}</span>
              </p>
              <p class="text-xs text-muted-foreground">直接使用火山官方音色，无需训练或支付声音复刻槽位费；生成用量仍按火山引擎规则计费。</p>
            </div>

            <div v-if="generationMode === 'profile'" class="space-y-2">
              <label class="text-sm font-medium">复刻音色</label>
              <Select v-model="selectedProfileId">
                <SelectTrigger class="h-10"><SelectValue placeholder="选择已训练完成的音色" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="profile in usableProfiles" :key="profile.id" :value="profile.id">
                    {{ profile.name }} · {{ profileStatusLabel(profile) }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p v-if="usableProfiles.length === 0" class="text-xs text-muted-foreground">请先在音色复刻页完成训练并启用一个音色。</p>
            </div>

            <div v-if="generationMode === 'reference_audio' || generationMode === 'reference_image'" class="space-y-2">
              <label class="text-sm font-medium">{{ generationMode === 'reference_image' ? '参考图片' : '参考音频' }}</label>
              <input ref="referenceInput" type="file" class="hidden" :accept="referenceAccept" :multiple="generationMode === 'reference_audio'" @change="handleReferenceFiles">
              <button type="button" class="flex min-h-24 w-full items-center justify-center gap-2 border border-dashed text-sm text-muted-foreground transition-[border-color,color,background-color,transform] hover:bg-muted/35 hover:bg-primary/5 hover:text-foreground active:scale-[0.96]" @click="referenceInput?.click()">
                <Upload class="h-4 w-4" />
                {{ references.length ? `已选择 ${references.length} 个文件` : '选择参考文件' }}
              </button>
              <div v-if="references.length" class="grid gap-2 sm:grid-cols-2">
                <div v-for="item in references" :key="item.previewUrl" class="flex min-w-0 items-center gap-2 border bg-muted/20 p-2">
                  <img v-if="item.kind === 'image'" :src="item.previewUrl" class="h-10 w-10 object-cover outline outline-1 outline-black/10 dark:outline-white/10">
                  <FileAudio v-else class="h-5 w-5 shrink-0 text-primary" />
                  <span class="min-w-0 truncate text-xs">{{ item.file.name }}</span>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium">生成内容</label>
              <Textarea v-model="generationPrompt" class="min-h-44 resize-y text-sm leading-6" maxlength="3000" placeholder="输入对白、旁白，或描述需要的音色、情绪、环境音与节奏。" />
              <div class="flex justify-end text-xs tabular-nums text-muted-foreground">{{ generationPrompt.length }}/3000</div>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-2"><label class="text-sm font-medium">素材名称</label><Input v-model="generationName" maxlength="80" placeholder="自动命名" /></div>
              <div class="space-y-2">
                <label class="text-sm font-medium">保存分类</label>
                <Select v-model="generationCategory">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="narration">旁白</SelectItem>
                    <SelectItem value="character_voice">角色音色</SelectItem>
                    <SelectItem value="sfx">音效</SelectItem>
                    <SelectItem value="bgm">背景音乐</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <button type="button" class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" @click="showAdvanced = !showAdvanced">
              <Settings class="h-4 w-4" />高级参数
            </button>
            <div v-if="showAdvanced" class="grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <div class="space-y-2"><label class="text-xs text-muted-foreground">采样率</label><Select v-model="sampleRate"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="16000">16 kHz</SelectItem><SelectItem value="24000">24 kHz</SelectItem><SelectItem value="44100">44.1 kHz</SelectItem><SelectItem value="48000">48 kHz</SelectItem></SelectContent></Select></div>
              <div class="space-y-2"><label class="text-xs text-muted-foreground">语速</label><Input v-model.number="speechRate" type="number" min="-50" max="100" /></div>
              <div class="space-y-2"><label class="text-xs text-muted-foreground">音量</label><Input v-model.number="loudnessRate" type="number" min="-50" max="100" /></div>
              <div class="space-y-2"><label class="text-xs text-muted-foreground">音调</label><Input v-model.number="pitchRate" type="number" min="-50" max="100" /></div>
              <label class="flex items-center gap-2 text-sm"><Switch v-model:checked="enableSubtitle" />生成字幕</label>
            </div>

            <div class="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p class="text-xs text-destructive">{{ generationError }}</p>
              <Button class="gap-2 active:scale-[0.96] transition-transform" :disabled="generating || !health?.configured" @click="submitGeneration">
                <Loader2 v-if="generating" class="h-4 w-4 animate-spin" /><Sparkles v-else class="h-4 w-4" />
                {{ generating ? '提交中...' : '生成声音' }}
              </Button>
            </div>
          </section>
        </div>

        <div v-else-if="activeView === 'clone'" class="grid gap-5 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
          <section class="space-y-5 border bg-background p-5 shadow-sm">
            <div><h2 class="text-base font-semibold">创建固定音色</h2><p class="mt-1 text-xs text-muted-foreground">录制或上传清晰的单人声音样本，先训练试听，确认效果后再决定是否付费启用。</p></div>
            <div class="border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-xs leading-5">
              <div class="flex items-start gap-2">
                <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div class="min-w-0">
                  <p class="font-medium text-foreground">后付费音色：¥138 / 个</p>
                  <p class="mt-1 text-muted-foreground">提交训练不会立即收取槽位费；首次正式生成语音时收费，生成内容另按用量计费。正式调用后音色会锁定，不能再次训练；试听音色 7 天内未正式调用会由火山引擎删除。</p>
                  <button type="button" class="mt-1.5 inline-flex items-center gap-1 font-medium text-primary hover:underline" @click="openVoiceBillingDoc">查看火山引擎计费说明<ExternalLink class="h-3 w-3" /></button>
                </div>
              </div>
            </div>
            <div class="space-y-2"><label class="text-sm font-medium">音色名称</label><Input v-model="cloneName" maxlength="80" placeholder="例如：旁白女声、角色阿澈" /></div>
            <div class="space-y-2">
              <label class="text-sm font-medium">声音样本</label>
              <input id="clone-audio-file" type="file" class="hidden" accept="audio/mp3,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac" @change="handleCloneFile">
              <div class="grid min-h-24 grid-cols-2 divide-x border border-dashed">
                <button
                  type="button"
                  class="flex min-w-0 flex-col items-center justify-center gap-2 px-3 text-sm text-muted-foreground transition-[color,background-color,transform] hover:bg-primary/5 hover:text-foreground active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="recording"
                  @click="startRecording"
                >
                  <MicVocal class="h-5 w-5" />
                  <span>麦克风录制</span>
                </button>
                <label for="clone-audio-file" class="flex min-w-0 cursor-pointer flex-col items-center justify-center gap-2 px-3 text-sm text-muted-foreground transition-[color,background-color,transform] hover:bg-primary/5 hover:text-foreground active:scale-[0.96]">
                  <Upload class="h-5 w-5" />
                  <span class="max-w-full truncate">{{ cloneFile?.name || '上传音频' }}</span>
                </label>
              </div>
              <div v-if="recording" class="flex items-center justify-between border bg-destructive/5 px-3 py-2.5">
                <span class="inline-flex items-center gap-2 text-sm font-medium text-destructive"><span class="h-2 w-2 rounded-full bg-destructive" />正在录音 {{ recordingLabel() }}</span>
                <Button size="sm" variant="outline" class="gap-1.5 transition-transform active:scale-[0.96]" @click="stopRecording"><Square class="h-3.5 w-3.5 fill-current" />停止</Button>
              </div>
              <audio v-if="clonePreviewUrl" class="h-10 w-full" controls :src="clonePreviewUrl" />
              <p class="text-xs text-muted-foreground">建议录制 10–60 秒安静环境下的单人语音。提交后原始录音不会保存到个人资源库。</p>
            </div>
            <div class="space-y-2"><label class="text-sm font-medium">样本对应文本</label><Textarea v-model="cloneReferenceText" class="min-h-20" placeholder="填写样本中实际朗读的文字，可提高训练校验准确度。" /></div>
            <div class="space-y-2"><label class="text-sm font-medium">试听文本</label><Textarea v-model="cloneDemoText" class="min-h-20" maxlength="300" /></div>
            <div class="space-y-2"><label class="text-sm font-medium">语言</label><Select v-model="cloneLanguage"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">中文</SelectItem><SelectItem value="1">英文</SelectItem><SelectItem value="2">日语</SelectItem><SelectItem value="8">韩语</SelectItem><SelectItem value="6">德语</SelectItem><SelectItem value="7">法语</SelectItem><SelectItem value="17">巴西葡萄牙语</SelectItem></SelectContent></Select></div>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex items-center justify-between border px-3 py-2.5 text-sm"><span>样本降噪</span><Switch v-model:checked="enableAudioDenoise" /></label>
              <label class="flex items-center justify-between border px-3 py-2.5 text-sm"><span>保留原始音量</span><Switch v-model:checked="disableVolumeNormalization" /></label>
            </div>
            <label class="flex items-start gap-2 border bg-muted/20 px-3 py-3 text-xs leading-5"><input v-model="consentConfirmed" type="checkbox" class="mt-0.5 h-4 w-4 accent-primary"><span>我确认已获得该声音所有者的明确授权，并同意将样本提交至豆包语音用于声音复刻。</span></label>
            <div class="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><p class="text-xs text-destructive">{{ cloneError }}</p><Button class="gap-2 active:scale-[0.96] transition-transform" :disabled="cloning || !health?.configured" @click="submitClone"><Loader2 v-if="cloning" class="h-4 w-4 animate-spin" /><MicVocal v-else class="h-4 w-4" />{{ cloning ? '提交训练中...' : '开始复刻' }}</Button></div>
          </section>

          <section class="space-y-3">
            <div class="flex items-center justify-between"><div><h2 class="text-sm font-semibold">我的音色</h2><p class="mt-1 text-xs text-muted-foreground">{{ profiles.length }} 个复刻音色</p></div></div>
            <div v-if="profiles.length === 0" class="flex min-h-56 flex-col items-center justify-center border border-dashed text-muted-foreground"><MicVocal class="mb-2 h-6 w-6" /><p class="text-sm">还没有复刻音色</p></div>
            <div class="grid gap-3 md:grid-cols-2">
              <article v-for="profile in profiles" :key="profile.id" class="space-y-3 border bg-background p-4 shadow-sm">
                <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h3 class="truncate text-sm font-semibold">{{ profile.name }}</h3><p class="mt-1 truncate font-mono text-[11px] text-muted-foreground">{{ profile.speakerId }}</p></div><span class="shrink-0 px-2 py-1 text-[11px]" :class="profileStatusClass(profile)">{{ profileStatusLabel(profile) }}</span></div>
                <audio v-if="profile.previewAudioUrl || profile.sourceAudioUrl" class="h-9 w-full" controls preload="metadata" :src="profile.previewAudioUrl || profile.sourceAudioUrl" />
                <p v-if="profile.errorMessage" class="text-xs text-destructive">{{ profile.errorMessage }}</p>
                <div class="flex items-center justify-between gap-3 border-t pt-3">
                  <span class="text-xs text-muted-foreground">{{ formatDate(profile.updatedAt) }}</span>
                  <div class="flex items-center gap-1">
                    <Button v-if="(profile.status === 'ready' || profile.status === 'active') && !profile.activatedAt" size="sm" class="gap-1.5 transition-transform active:scale-[0.96]" :disabled="activatingProfileId === profile.id" @click="activateProfile(profile)"><Loader2 v-if="activatingProfileId === profile.id" class="h-3.5 w-3.5 animate-spin" /><Check v-else class="h-3.5 w-3.5" />¥138 启用</Button>
                    <span v-else-if="profile.activatedAt" class="inline-flex items-center gap-1 text-xs text-emerald-600"><Check class="h-3.5 w-3.5" />已启用</span>
                    <Button size="icon" variant="ghost" class="h-8 w-8 active:scale-[0.96] transition-transform" title="刷新状态" @click="refreshProfile(profile)"><Loader2 v-if="refreshingProfileId === profile.id" class="h-4 w-4 animate-spin" /><RefreshCw v-else class="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground hover:text-destructive active:scale-[0.96] transition-transform" title="归档" @click="archiveProfile(profile)"><Archive class="h-4 w-4" /></Button>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>

        <section v-else class="space-y-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 class="text-lg font-semibold">任务列表</h2>
              <p class="mt-1 text-sm text-muted-foreground">最近 100 条生成任务，完成结果会自动保存到个人资源库。</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs tabular-nums text-muted-foreground">{{ tasks.length }} 条</span>
              <Button variant="outline" size="sm" :disabled="loading" @click="loadData()">
                <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
                <RefreshCw v-else class="mr-2 h-4 w-4" />
                {{ loading ? '正在刷新' : '刷新列表' }}
              </Button>
            </div>
          </div>

          <div v-if="tasks.length === 0" class="flex min-h-56 flex-col items-center justify-center rounded-xl bg-muted/15 bg-muted/10 p-8 text-center">
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <History class="h-6 w-6" />
            </div>
            <p class="mt-4 text-base font-semibold">暂无声音任务</p>
            <p class="mt-1 text-sm text-muted-foreground">提交声音生成后，任务会出现在这里。</p>
            <Button size="sm" class="mt-4" @click="activeView = 'generate'">
              提交生成
            </Button>
          </div>

          <div v-else class="overflow-hidden rounded-xl bg-muted/25">
            <div class="hidden grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)_120px_150px] gap-4 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
              <div>任务</div>
              <div>音频结果</div>
              <div>状态</div>
              <div class="text-right">操作</div>
            </div>
            <article
              v-for="task in tasks"
              :key="task.id"
              class="grid gap-3 border-b p-4 transition-colors last:border-b-0 hover:bg-muted/30 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)_120px_150px] lg:items-center"
            >
              <div class="min-w-0">
                <h3 class="truncate text-sm font-medium">{{ task.name }}</h3>
                <p class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{{ task.prompt }}</p>
                <p class="mt-1 text-xs text-muted-foreground">{{ formatDate(task.createdAt) }}</p>
                <p v-if="task.errorMessage" class="mt-1 text-xs text-destructive">{{ task.errorMessage }}</p>
              </div>
              <audio v-if="task.audioUrl" class="h-9 w-full" controls preload="metadata" :src="task.audioUrl" />
              <div v-else class="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                <Clock3 class="h-4 w-4" />
                {{ task.status === 'failed' ? '未生成音频' : '等待生成结果' }}
              </div>
              <div class="flex items-center gap-2 lg:block">
                <span class="inline-flex px-2 py-1 text-[11px]" :class="statusClass(task.status)">{{ taskStatusLabel(task.status) }}</span>
                <span class="text-xs text-muted-foreground lg:mt-1 lg:block">{{ formatDuration(task.durationMs) }}</span>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-1">
                <a v-if="task.audioUrl" :href="task.audioUrl" download>
                  <Button size="icon" variant="ghost" class="h-8 w-8 active:scale-[0.96] transition-transform" title="下载">
                    <Download class="h-4 w-4" />
                  </Button>
                </a>
                <Button v-if="task.status === 'failed'" size="sm" variant="outline" class="gap-1.5 active:scale-[0.96] transition-transform" @click="retryTask(task)">
                  <RotateCcw class="h-3.5 w-3.5" />重试
                </Button>
                <span v-if="task.resultAssetId" class="inline-flex items-center gap-1 text-xs text-emerald-600">
                  <Check class="h-3.5 w-3.5" />已入库
                </span>
              </div>
            </article>
          </div>
        </section>
      </template>
    </AppPageContent>
  </AppPage>
</template>
