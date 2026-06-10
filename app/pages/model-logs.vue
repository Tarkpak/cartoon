<script setup lang="ts">
definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()

onMounted(() => {
  router.replace({
    path: '/logs',
    query: {
      ...route.query,
      tab: 'model'
    }
  })
})
</script>

<template>
  <div class="min-h-screen bg-background p-6 text-sm text-muted-foreground">
    正在打开日志...
  </div>
</template>
