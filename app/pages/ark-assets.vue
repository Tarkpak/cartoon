<script setup lang="ts">
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import ArkVirtualAssetsTab from '~/components/asset-workbench/ArkVirtualAssetsTab.vue'

definePageMeta({
  layout: 'default'
})
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="火山素材库"
      description="管理 Ark 私域虚拟人像素材组和素材资产，作为跨项目共享的公共资产库。"
    />

    <AppPageContent
      class="h-full"
      inner-class="flex h-full min-h-0"
    >
      <ArkVirtualAssetsTab />
    </AppPageContent>
  </AppPage>
</template>
