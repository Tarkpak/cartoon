import { invoke } from "@tauri-apps/api/core";

export interface DesktopFfmpegStatus {
  available: boolean;
  installSupported: boolean;
  source: "managed" | "env" | "system" | "missing";
  version?: string | null;
  path?: string | null;
  platform: string;
  managedPath?: string | null;
  message?: string | null;
}

interface RefreshDesktopFfmpegOptions {
  promptOnMissing?: boolean;
}

function detectDesktopRuntime(): boolean {
  if (!import.meta.client) return false;

  const runtime = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return !!runtime.__TAURI__ || !!runtime.__TAURI_INTERNALS__;
}

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "操作失败，请稍后重试。";
}

export function useDesktopFfmpeg() {
  const status = useState<DesktopFfmpegStatus | null>(
    "desktop-ffmpeg-status",
    () => null,
  );
  const checking = useState<boolean>("desktop-ffmpeg-checking", () => false);
  const installing = useState<boolean>(
    "desktop-ffmpeg-installing",
    () => false,
  );
  const error = useState<string>("desktop-ffmpeg-error", () => "");
  const dialogOpen = useState<boolean>(
    "desktop-ffmpeg-dialog-open",
    () => false,
  );
  const hasChecked = useState<boolean>(
    "desktop-ffmpeg-has-checked",
    () => false,
  );
  const promptDismissed = useState<boolean>(
    "desktop-ffmpeg-prompt-dismissed",
    () => false,
  );

  const isDesktopRuntime = computed(() => detectDesktopRuntime());
  const needsAttention = computed(() => {
    return (
      isDesktopRuntime.value && status.value !== null && !status.value.available
    );
  });
  const canAutoInstall = computed(() => {
    return !!status.value?.installSupported;
  });
  const usingManagedFfmpeg = computed(() => {
    return status.value?.source === "managed";
  });
  const statusLabel = computed(() => {
    if (!status.value) return "未检测";
    if (!status.value.available) return "未安装";
    if (status.value.source === "managed") return "已由 Playlet 托管";
    if (status.value.source === "env") return "使用自定义路径";
    return "使用系统安装";
  });
  const statusDescription = computed(() => {
    if (!status.value) return "尚未检测 FFmpeg 状态。";
    if (status.value.available) {
      if (status.value.source === "managed") {
        return "视频拼接与导出将使用 Playlet 管理的 FFmpeg，无需额外配置系统环境变量。";
      }
      if (status.value.source === "env") {
        return "当前优先使用 FFMPEG_PATH 指向的 FFmpeg 可执行文件。";
      }
      return "当前正在使用系统 PATH 中的 FFmpeg。";
    }

    return status.value.message || "未检测到可用的 FFmpeg。";
  });

  function applyStatus(
    nextStatus: DesktopFfmpegStatus,
    promptOnMissing: boolean,
  ) {
    status.value = nextStatus;
    hasChecked.value = true;

    if (nextStatus.available) {
      dialogOpen.value = false;
      promptDismissed.value = false;
      return;
    }

    if (
      promptOnMissing &&
      nextStatus.installSupported &&
      !promptDismissed.value
    ) {
      dialogOpen.value = true;
    }
  }

  async function refreshDesktopFfmpegStatus(
    options: RefreshDesktopFfmpegOptions = {},
  ) {
    if (!isDesktopRuntime.value) return null;

    checking.value = true;
    error.value = "";

    try {
      const nextStatus = await invoke<DesktopFfmpegStatus>(
        "check_ffmpeg_status",
      );
      applyStatus(nextStatus, options.promptOnMissing !== false);
      return nextStatus;
    } catch (invokeError) {
      error.value = normalizeError(invokeError);
      hasChecked.value = true;
      return null;
    } finally {
      checking.value = false;
    }
  }

  async function ensureDesktopFfmpegStatus() {
    if (!isDesktopRuntime.value) return null;
    if (hasChecked.value && status.value) return status.value;
    return refreshDesktopFfmpegStatus();
  }

  async function installDesktopFfmpeg() {
    if (!isDesktopRuntime.value) return null;

    installing.value = true;
    error.value = "";
    dialogOpen.value = true;

    try {
      const nextStatus = await invoke<DesktopFfmpegStatus>("install_ffmpeg");
      applyStatus(nextStatus, false);
      return nextStatus;
    } catch (invokeError) {
      error.value = normalizeError(invokeError);
      return null;
    } finally {
      installing.value = false;
    }
  }

  function openInstallDialog() {
    if (!isDesktopRuntime.value) return;
    promptDismissed.value = false;
    dialogOpen.value = true;
  }

  function closeInstallDialog() {
    dialogOpen.value = false;
    promptDismissed.value = true;
  }

  return {
    status,
    checking,
    installing,
    error,
    dialogOpen,
    isDesktopRuntime,
    needsAttention,
    canAutoInstall,
    usingManagedFfmpeg,
    statusLabel,
    statusDescription,
    ensureDesktopFfmpegStatus,
    refreshDesktopFfmpegStatus,
    installDesktopFfmpeg,
    openInstallDialog,
    closeInstallDialog,
  };
}
