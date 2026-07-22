<template>
  <n-config-provider>
    <n-message-provider>
      <n-dialog-provider>
        <NuxtPage :keepalive="pageKeepalive" />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
const route = useRoute()

const pageKeepalive = computed(() => route.path === '/login'
  ? false
  : { max: 12 })
</script>
