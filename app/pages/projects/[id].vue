<script setup lang="ts">
const route = useRoute()
const projectId = route.params.id as string

await navigateTo(`/workbench?project=${projectId}`, { redirectCode: 302 })
</script>

<template>
  <div />
</template>
