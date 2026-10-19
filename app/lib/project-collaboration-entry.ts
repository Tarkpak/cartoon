/** Opening a project always uses resource collaboration, including legacy links. */
export async function prepareProjectCollaboration(id: string) {
  const response = await $fetch<{ data: { enabled: boolean } }>(`/api/project/${encodeURIComponent(id)}/collaboration/prepare`, {
    method: 'POST', retry: 0, timeout: 180_000
  })
  if (response.data?.enabled !== true) throw new Error('协作迁移尚未确认完成，请重试；原始项目数据已保留')
}
