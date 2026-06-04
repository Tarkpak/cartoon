<script setup lang="ts">
import { AlertTriangle, Download, Loader2 } from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDesktopFfmpeg } from "@/composables/useDesktopFfmpeg";

const {
  status,
  error,
  dialogOpen,
  isDesktopRuntime,
  canAutoInstall,
  installing,
  installDesktopFfmpeg,
  closeInstallDialog,
} = useDesktopFfmpeg();

const shouldShowDialog = computed(() => {
  return (
    isDesktopRuntime.value &&
    !!status.value &&
    !status.value.available &&
    canAutoInstall.value
  );
});

const managedPathLabel = computed(() => {
  return status.value?.managedPath || "";
});

function handleOpenChange(nextOpen: boolean) {
  if (nextOpen) {
    dialogOpen.value = true;
    return;
  }

  closeInstallDialog();
}
</script>

<template>
  <Dialog
    v-if="shouldShowDialog"
    :open="dialogOpen"
    @update:open="handleOpenChange"
  >
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <AlertTriangle class="h-5 w-5 text-amber-500" />
          未检测到 FFmpeg
        </DialogTitle>
        <DialogDescription>
          Playlet 的视频拼接、导出和部分本地媒体处理依赖
          FFmpeg。当前未检测到可用安装，可直接由应用自动下载并安装到当前用户目录。
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3 text-sm">
        <div class="rounded-lg border bg-muted/30 p-3">
          <p class="font-medium text-foreground">
            安装后会自动接管视频处理能力
          </p>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            无需手动配置系统 PATH；安装完成后当前客户端会立即使用新安装的
            FFmpeg。
          </p>
        </div>

        <div
          v-if="managedPathLabel"
          class="rounded-lg border bg-background p-3"
        >
          <p class="text-xs font-medium text-foreground">安装位置</p>
          <p class="mt-1 break-all font-mono text-[11px] text-muted-foreground">
            {{ managedPathLabel }}
          </p>
        </div>

        <p
          v-if="error"
          class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {{ error }}
        </p>
      </div>

      <DialogFooter class="gap-2 sm:justify-end">
        <Button
          variant="outline"
          :disabled="installing"
          @click="closeInstallDialog"
        >
          稍后处理
        </Button>
        <Button :disabled="installing" @click="installDesktopFfmpeg">
          <Loader2 v-if="installing" class="h-4 w-4 animate-spin" />
          <Download v-else class="h-4 w-4" />
          {{ installing ? "安装中..." : "一键安装 FFmpeg" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
