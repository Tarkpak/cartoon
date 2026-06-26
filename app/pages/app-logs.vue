<script setup lang="ts">
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'

definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()

onMounted(() => {
  router.replace({
    path: '/logs',
    query: {
      ...route.query,
      tab: 'system'
    }
  })
})
</script>

<template>
  <AppPage>
    <AppPageContent scroll inner-class="text-sm text-muted-foreground">
      正在打开日志...
    </AppPageContent>
  </AppPage>
</template>
