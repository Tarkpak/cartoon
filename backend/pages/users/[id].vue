<template>
  <AdminShell>
    <div class="page">
      <div class="page-header page-header--actions">
        <n-button @click="$router.push('/users')">返回用户列表</n-button>
      </div>

      <n-spin :show="pending">
        <!-- 用户基本信息卡片 -->
        <n-card v-if="detail" style="margin-bottom: 16px">
          <div class="user-detail-header">
            <div class="user-avatar-section">
              <n-avatar :size="64" round>
                {{ detail.user.display_name?.charAt(0) || detail.user.account.charAt(0) }}
              </n-avatar>
            </div>
            <div class="user-info-section">
              <div class="user-title-row">
                <h2 class="user-title">{{ detail.user.display_name || detail.user.account }}</h2>
                <n-tag :type="detail.user.role === 'admin' ? 'warning' : 'info'" size="small">
                  {{ userRoleLabel(detail.user.role) }}
                </n-tag>
                <n-tag :type="detail.user.status === 'active' ? 'success' : 'error'" size="small">
                  {{ userStatusLabel(detail.user.status) }}
                </n-tag>
              </div>
              <div class="user-meta-grid">
                <span><strong>账号：</strong>{{ detail.user.account }}</span>
                <span v-if="detail.user.email"><strong>邮箱：</strong>{{ detail.user.email }}</span>
                <span v-if="detail.user.phone"><strong>手机：</strong>{{ detail.user.phone }}</span>
                <span><strong>注册时间：</strong>{{ formatAdminDateTime(detail.user.created_at) }}</span>
                <span><strong>最后登录：</strong>{{ formatAdminDateTime(detail.user.last_login_at) }}</span>
                <span><strong>更新时间：</strong>{{ formatAdminDateTime(detail.user.updated_at) }}</span>
              </div>
            </div>
            <div class="user-actions-section">
              <n-space vertical>
                <n-button
                  :type="detail.user.status === 'active' ? 'error' : 'success'"
                  @click="showStatusConfirm = true"
                >
                  {{ detail.user.status === 'active' ? '禁用用户' : '启用用户' }}
                </n-button>
                <n-button @click="showEditDialog = true">编辑信息</n-button>
                <n-button @click="showResetPasswordDialog = true">重置密码</n-button>
                <n-button type="primary" @click="openCreditAdjustment('add')">增加积分</n-button>
                <n-button type="warning" @click="openCreditAdjustment('deduct')">减少积分</n-button>
              </n-space>
            </div>
          </div>
        </n-card>

        <n-grid v-if="detail" :cols="4" :x-gap="16" style="margin-bottom: 16px">
          <n-gi><n-card><n-statistic label="项目" :value="detail.stats.projectCount" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="提示词模板" :value="detail.stats.promptTemplateCount" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="模型偏好" :value="detail.stats.preferenceCount" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="调用日志" :value="detail.stats.logCount" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="积分余额" :value="creditAccount.balance" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="累计增加" :value="creditAccount.totalAdded" /></n-card></n-gi>
          <n-gi><n-card><n-statistic label="累计消耗" :value="creditAccount.totalConsumed" /></n-card></n-gi>
        </n-grid>

        <ClientOnly>
          <n-tabs type="line">
            <n-tab-pane name="projects" tab="项目">
              <n-data-table
                :columns="projectColumns"
                :data="projects"
                :row-props="projectRowProps"
                :loading="projectsLoading"
                :pagination="projectsPagination"
                @update:page="handleProjectsPageChange"
              />
              <n-drawer v-model:show="projectDrawer" :width="projectDrawerWidth">
                <n-drawer-content title="项目详情">
                  <div v-if="selectedProject" class="workbench-readonly">
                    <header class="workbench-header">
                      <div class="workbench-title">
                        <h3>{{ projectWorkbenchTitle }}</h3>
                        <div class="workbench-meta">
                          <span v-if="projectDescription">{{ projectDescription }}</span>
                          <span>画风 {{ projectWorkbenchStyle }}</span>
                          <span>{{ projectWorkbenchAspectRatio }}</span>
                          <span>{{ scriptParseModeLabel(projectWorkbenchParseMode) }}</span>
                        </div>
                      </div>
                      <div class="workbench-stage-switcher">
                        <template
                          v-for="(stage, index) in projectStageItems"
                          :key="stage.key"
                        >
                          <span
                            v-if="index > 0"
                            class="stage-connector"
                            :class="{ 'stage-connector--done': stage.status === 'done' }"
                          />
                          <button
                            type="button"
                            class="stage-pill"
                            :class="[
                              `stage-pill--${stage.status}`,
                              { 'stage-pill--active': activeProjectStage === stage.key }
                            ]"
                            @click="activeProjectStage = stage.key"
                          >
                            <span class="stage-index">{{ stage.status === 'done' ? '✓' : index + 1 }}</span>
                            <span>{{ stage.label }}</span>
                          </button>
                        </template>
                      </div>
                    </header>

                    <section class="workbench-panel">
                      <div v-if="activeProjectStage === 'parse'" class="readonly-stage">
                        <div class="script-reader">
                          <pre v-if="projectNovelText" class="script-reader__content">{{ projectNovelText }}</pre>
                          <div v-else class="empty-block">暂无剧本原文</div>
                          <div class="script-reader__badge">{{ projectNovelStats }}</div>
                        </div>

                        <div class="readonly-status-row">
                          <span><i class="dot dot--green"></i>{{ rawProjectScenes.length }} 个场景</span>
                          <span><i class="dot dot--blue"></i>{{ rawProjectCharacters.length }} 个角色</span>
                          <span><i class="dot dot--amber"></i>{{ projectEpisodeCards.length }} 集</span>
                        </div>

                        <section v-if="projectEpisodeCards.length" class="readonly-section">
                          <div class="section-title">分集目录</div>
                          <div class="episode-grid">
                            <article
                              v-for="episode in projectEpisodeCards"
                              :key="episode.id"
                              class="episode-card"
                            >
                              <div class="episode-card__head">
                                <strong>{{ episode.title }}</strong>
                                <span>第 {{ episode.index }} 集</span>
                              </div>
                              <p v-if="episode.overview">{{ episode.overview }}</p>
                              <div class="episode-card__meta">
                                <span v-for="item in episode.meta" :key="item">{{ item }}</span>
                              </div>
                              <dl v-if="episode.beats.length" class="episode-beats">
                                <template v-for="beat in episode.beats" :key="beat.label">
                                  <dt>{{ beat.label }}</dt>
                                  <dd>{{ beat.value }}</dd>
                                </template>
                              </dl>
                            </article>
                          </div>
                        </section>
                      </div>

                      <div v-else-if="activeProjectStage === 'assets'" class="readonly-stage">
                        <div class="readonly-status-row readonly-status-row--split">
                          <div>
                            <span><i class="dot" :class="assetReadyDotClass"></i>角色图 {{ projectCharacterReadyCount }}/{{ rawProjectCharacters.length }}</span>
                            <span v-if="projectCharacterMissingCount > 0"><i class="dot dot--amber"></i>待生成 {{ projectCharacterMissingCount }}</span>
                            <span><i class="dot dot--green"></i>环境 {{ projectEnvironmentCards.length }}</span>
                            <span><i class="dot dot--violet"></i>素材 {{ projectPropCards.length + projectOtherAssetCards.length }}</span>
                          </div>
                        </div>

                        <div class="asset-tabbar">
                          <button
                            v-for="tab in projectAssetTabs"
                            :key="tab.key"
                            type="button"
                            class="asset-tab"
                            :class="{ 'asset-tab--active': activeProjectAssetTab === tab.key }"
                            @click="activeProjectAssetTab = tab.key"
                          >
                            {{ tab.label }} <span>{{ tab.count }}</span>
                          </button>
                        </div>

                        <div v-if="activeProjectAssetTab === 'characters'" class="client-card-grid client-card-grid--two">
                          <article
                            v-for="character in projectCharacterCards"
                            :key="character.id"
                            class="client-character-card"
                          >
                            <div class="client-character-card__body">
                              <div class="client-avatar">
                                <img v-if="character.imageUrl" :src="character.imageUrl" :alt="`${character.name} 角色图`" loading="lazy">
                                <span v-else>角色</span>
                                <i :class="character.statusClass"></i>
                              </div>
                              <div class="client-card-main">
                                <div class="client-card-title">
                                  <strong>{{ character.name }}</strong>
                                  <span>{{ character.roleLabel }}</span>
                                  <span v-if="character.variantName" class="mini-badge">变体</span>
                                </div>
                                <p>{{ character.appearance || '暂无外观描述' }}</p>
                                <div class="client-card-meta">
                                  <span>{{ character.sceneCount }} 个场景</span>
                                  <span>{{ character.statusText }}</span>
                                </div>
                              </div>
                            </div>
                            <div class="client-audio-row">
                              <div>
                                <strong>角色参考音频</strong>
                                <span>{{ character.voiceLabel }}</span>
                              </div>
                              <n-tag v-if="character.voiceLocked" size="small" type="info">已锁定参考</n-tag>
                            </div>
                            <audio
                              v-if="character.voiceUrl"
                              :src="character.voiceUrl"
                              controls
                              preload="none"
                            />
                          </article>
                          <n-empty v-if="projectCharacterCards.length === 0" description="暂未识别到角色" />
                        </div>

                        <div v-else-if="activeProjectAssetTab === 'environments'" class="client-card-grid client-card-grid--two">
                          <article
                            v-for="environment in projectEnvironmentCards"
                            :key="environment.id"
                            class="client-environment-card"
                          >
                            <div class="environment-preview-grid">
                              <div
                                v-for="view in environment.views"
                                :key="view.label"
                                class="environment-preview"
                              >
                                <img v-if="view.image" :src="view.image" :alt="`${environment.name} ${view.label}`" loading="lazy">
                                <span v-else>暂无{{ view.label }}</span>
                                <b>{{ view.label }}</b>
                              </div>
                              <n-tag class="environment-status" size="small" :type="environment.statusType">{{ environment.statusText }}</n-tag>
                            </div>
                            <div class="client-card-main client-card-main--padded">
                              <div class="client-card-title">
                                <strong>{{ environment.name }}</strong>
                                <span>{{ environment.sceneTitles.length }}</span>
                              </div>
                              <p>{{ environment.summary }}</p>
                              <p v-if="environment.description">{{ environment.description }}</p>
                            </div>
                          </article>
                          <n-empty v-if="projectEnvironmentCards.length === 0" description="暂无环境素材" />
                        </div>

                        <div v-else class="client-card-grid client-card-grid--two">
                          <article
                            v-for="asset in activeReadonlyPropCards"
                            :key="asset.id"
                            class="client-prop-card"
                          >
                            <div class="client-prop-preview">
                              <img v-if="asset.imageUrl" :src="asset.imageUrl" :alt="asset.name" loading="lazy">
                              <audio v-else-if="asset.voiceUrl" :src="asset.voiceUrl" controls preload="none" />
                              <span v-else>{{ asset.mediaLabel }}</span>
                            </div>
                            <div class="client-card-main client-card-main--padded">
                              <div class="client-card-title">
                                <strong>{{ asset.name }}</strong>
                                <span>{{ asset.mediaLabel }}</span>
                              </div>
                              <p>{{ asset.description || '暂无描述' }}</p>
                              <div class="client-card-meta">
                                <span>{{ asset.usageCount }} 个场景</span>
                                <span>{{ asset.readyText }}</span>
                              </div>
                            </div>
                          </article>
                          <n-empty
                            v-if="activeReadonlyPropCards.length === 0"
                            :description="activeProjectAssetTab === 'props' ? '暂无道具素材' : '暂无其他素材'"
                          />
                        </div>
                      </div>

                      <div v-else-if="activeProjectStage === 'videos'" class="readonly-stage">
                        <div class="readonly-status-row">
                          <span><i class="dot dot--blue"></i>场景 {{ rawProjectScenes.length }}</span>
                          <span><i class="dot dot--amber"></i>分集 {{ projectEpisodeDirectoryItems.length }}</span>
                          <span><i class="dot dot--green"></i>环境图就绪 {{ projectReadySceneCount }}</span>
                          <span><i class="dot dot--violet"></i>视频完成 {{ projectVideoDoneCount }}</span>
                          <span v-if="projectVideoErrorCount > 0"><i class="dot dot--red"></i>失败 {{ projectVideoErrorCount }}</span>
                        </div>

                        <div class="video-stage-grid">
                          <aside v-if="projectEpisodeDirectoryItems.length" class="episode-directory">
                            <div class="episode-directory__head">
                              <strong>分集目录</strong>
                              <span>共 {{ projectEpisodeDirectoryItems.length }} 集</span>
                            </div>
                            <button
                              v-for="episode in projectEpisodeDirectoryItems"
                              :key="episode.id"
                              type="button"
                              class="episode-directory__item"
                              :class="{ 'episode-directory__item--active': currentProjectEpisodeId === episode.id }"
                              @click="selectedProjectEpisodeId = episode.id"
                            >
                              <strong>{{ episode.title }}</strong>
                              <span>{{ episode.stats }}</span>
                            </button>
                            <div v-if="selectedProjectEpisodeInfo" class="episode-directory__detail">
                              <span v-for="item in selectedProjectEpisodeInfo.meta" :key="item">{{ item }}</span>
                              <p v-if="selectedProjectEpisodeInfo.overview">概览：{{ selectedProjectEpisodeInfo.overview }}</p>
                            </div>
                          </aside>

                          <div class="scene-list">
                            <div class="scene-list__head">{{ projectSceneListHeader }}</div>
                            <article
                              v-for="scene in selectedProjectEpisodeScenes"
                              :key="scene.id"
                              class="scene-video-card"
                            >
                              <div class="scene-video-card__head">
                                <div>
                                  <span>场景 {{ scene.index + 1 }}</span>
                                  <strong>{{ scene.title }}</strong>
                                </div>
                                <div class="scene-badges">
                                  <n-tag size="small" :type="scene.referenceTagType">{{ scene.referenceLabel }}</n-tag>
                                  <n-tag size="small" :type="scene.videoTagType">{{ scene.videoLabel }}</n-tag>
                                </div>
                              </div>
                              <p>{{ scene.description }}</p>
                              <div class="scene-media-row">
                                <div class="scene-frame">
                                  <img v-if="scene.referenceImage" :src="scene.referenceImage" :alt="`${scene.title} 环境图`" loading="lazy">
                                  <span v-else>暂无环境图</span>
                                </div>
                                <video
                                  v-if="scene.videoUrl"
                                  :src="scene.videoUrl"
                                  controls
                                  preload="metadata"
                                ></video>
                              </div>
                              <div class="client-card-meta">
                                <span v-for="item in scene.meta" :key="item">{{ item }}</span>
                              </div>
                              <p v-if="scene.narration" class="scene-narration">旁白：{{ scene.narration }}</p>
                            </article>
                            <n-empty v-if="selectedProjectEpisodeScenes.length === 0" description="当前分集暂无场景" />
                          </div>
                        </div>
                      </div>

                      <div v-else class="readonly-stage">
                        <div class="readonly-status-row">
                          <span><i class="dot dot--violet"></i>可合成视频 {{ projectVideoDoneCount }} 个</span>
                          <span><i class="dot dot--blue"></i>时间线 {{ projectFinalSceneCards.length }} 段</span>
                        </div>

                        <div class="final-stage-grid">
                          <section class="final-options-card">
                            <div class="section-title">合成参数</div>
                            <dl>
                              <dt>转场类型</dt>
                              <dd>{{ projectFinalOptions.transitionType }}</dd>
                              <dt>转场时长</dt>
                              <dd>{{ projectFinalOptions.transitionDuration }}</dd>
                              <dt>字幕</dt>
                              <dd>{{ projectFinalOptions.addSubtitles }}</dd>
                              <dt>BGM</dt>
                              <dd>{{ projectFinalOptions.bgmUrl }}</dd>
                              <dt>BGM 音量</dt>
                              <dd>{{ projectFinalOptions.bgmVolume }}</dd>
                            </dl>
                          </section>

                          <section class="final-timeline-card">
                            <div class="section-title">场景顺序</div>
                            <div class="final-scene-list">
                              <div
                                v-for="scene in projectFinalSceneCards"
                                :key="scene.id"
                                class="final-scene-item"
                              >
                                <span>{{ scene.index + 1 }}</span>
                                <strong>{{ scene.title }}</strong>
                                <em>{{ scene.duration }}</em>
                                <n-tag size="small" :type="scene.tagType">{{ scene.statusText }}</n-tag>
                              </div>
                            </div>
                          </section>
                        </div>

                        <section v-if="projectFinalVideo" class="final-video-card">
                          <div class="section-title">最终成片</div>
                          <video :src="projectFinalVideo.videoUrl" controls preload="metadata"></video>
                          <div class="client-card-meta">
                            <span v-if="projectFinalVideo.duration">时长 {{ formatProjectDuration(projectFinalVideo.duration) }}</span>
                            <span v-if="projectFinalVideo.size">大小 {{ formatFileSize(projectFinalVideo.size) }}</span>
                            <span v-if="projectFinalVideo.updatedAt">更新 {{ formatAdminDateTime(projectFinalVideo.updatedAt) }}</span>
                          </div>
                        </section>
                        <n-empty v-else description="暂无最终成片" />
                      </div>
                    </section>
                  </div>
                </n-drawer-content>
              </n-drawer>
            </n-tab-pane>
            <n-tab-pane name="prompts" tab="提示词">
              <div class="detail-stack">
                <div class="metric-grid">
                  <div
                    v-for="item in promptMetricItems"
                    :key="item.label"
                    class="metric-item"
                  >
                    <strong>{{ item.value }}</strong>
                    <span>{{ item.label }}</span>
                  </div>
                </div>

                <section class="visual-section">
                  <div class="section-title">配置方案</div>
                  <div v-if="promptProfileItems.length" class="profile-grid">
                    <article
                      v-for="profile in promptProfileItems"
                      :key="profile.id"
                      class="profile-item"
                    >
                      <div class="profile-head">
                        <div>
                          <div class="preview-title">{{ profile.name }}</div>
                          <div class="preview-subtitle">{{ profile.localProfileId }}</div>
                        </div>
                        <n-tag v-if="profile.active" size="small" type="success">当前</n-tag>
                      </div>
                      <p v-if="profile.description" class="preview-description">{{ profile.description }}</p>
                      <div class="preview-meta">
                        <span>更新 {{ profile.updatedAt }}</span>
                      </div>
                    </article>
                  </div>
                  <n-empty v-else description="暂无配置方案" />
                </section>

                <section class="visual-section">
                  <div class="section-title">提示词模板</div>
                  <div v-if="promptTemplateItems.length" class="template-list">
                    <article
                      v-for="template in promptTemplateItems"
                      :key="template.id"
                      class="template-item"
                    >
                      <div class="template-head">
                        <div>
                          <div class="preview-title">{{ template.title }}</div>
                          <div class="preview-subtitle">{{ template.templateKey }}</div>
                        </div>
                        <div class="template-tags">
                          <n-tag size="small" :type="template.sourceType">{{ template.sourceLabel }}</n-tag>
                          <n-tag v-if="template.profileName" size="small" type="info">{{ template.profileName }}</n-tag>
                        </div>
                      </div>
                      <pre v-if="template.content" class="prompt-content">{{ template.content }}</pre>
                      <div v-else class="empty-inline">暂无模板内容</div>
                      <div class="preview-meta">
                        <span>更新 {{ template.updatedAt }}</span>
                      </div>
                    </article>
                  </div>
                  <n-empty v-else description="暂无提示词模板" />
                </section>
              </div>
            </n-tab-pane>
            <n-tab-pane name="models" tab="模型选择">
              <n-data-table
                :columns="preferenceColumns"
                :data="preferences"
                :loading="preferencesLoading"
                :pagination="preferencesPagination"
                @update:page="handlePreferencesPageChange"
              />
            </n-tab-pane>
            <n-tab-pane name="devices" tab="设备">
              <n-data-table
                :columns="deviceColumns"
                :data="devices"
                :loading="devicesLoading"
                :pagination="devicesPagination"
                @update:page="handleDevicesPageChange"
              />
            </n-tab-pane>
            <n-tab-pane name="credits" tab="积分流水">
              <n-space vertical>
                <n-space>
                  <n-select
                    v-model:value="creditTransactionType"
                    placeholder="流水类型"
                    clearable
                    style="width: 160px"
                    :options="creditTransactionTypeOptions"
                  />
                  <n-date-picker
                    v-model:value="creditDateRange"
                    type="daterange"
                    clearable
                    style="width: 260px"
                  />
                  <n-button type="primary" @click="refreshCredits">筛选</n-button>
                  <n-button @click="exportCredits">导出 CSV</n-button>
                </n-space>
                <n-grid :cols="4" :x-gap="12">
                  <n-gi><n-card size="small"><n-statistic label="区间增加" :value="creditPeriod.added" /></n-card></n-gi>
                  <n-gi><n-card size="small"><n-statistic label="区间手动减少" :value="creditPeriod.deducted" /></n-card></n-gi>
                  <n-gi><n-card size="small"><n-statistic label="区间模型消耗" :value="creditPeriod.consumed" /></n-card></n-gi>
                  <n-gi><n-card size="small"><n-statistic label="流水条数" :value="creditPeriod.transactionCount" /></n-card></n-gi>
                </n-grid>
                <n-data-table
                  :columns="creditColumns"
                  :data="creditTransactions"
                  :loading="creditsLoading"
                  :pagination="creditsPagination"
                  remote
                  @update:page="handleCreditsPageChange"
                  @update:page-size="handleCreditsPageSizeChange"
                />
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="logs" tab="调用日志">
              <n-space vertical>
                <n-space>
                  <n-input v-model:value="logsKeyword" placeholder="搜索请求ID或错误信息" clearable style="width: 300px" />
                  <n-select v-model:value="logsProvider" placeholder="供应商" clearable style="width: 150px" :options="providerOptions" />
                  <n-select v-model:value="logsStatus" placeholder="状态" clearable style="width: 120px" :options="statusOptions" />
                  <n-button type="primary" @click="loadLogs">搜索</n-button>
                </n-space>
                <n-data-table
                  :columns="logColumns"
                  :data="logs"
                  :loading="logsLoading"
                  :pagination="logsPagination"
                  @update:page="handleLogsPageChange"
                />
              </n-space>
            </n-tab-pane>
            <n-tab-pane name="audit" tab="操作审计">
              <n-space vertical>
                <n-input v-model:value="auditKeyword" placeholder="搜索操作类型或目标" clearable style="width: 300px" @keyup.enter="loadAuditLogs" />
                <n-data-table
                  :columns="auditColumns"
                  :data="auditLogs"
                  :loading="auditLoading"
                  :pagination="auditPagination"
                  @update:page="handleAuditPageChange"
                />
              </n-space>
            </n-tab-pane>
          </n-tabs>
        </ClientOnly>
      </n-spin>

      <!-- 禁用/启用用户确认对话框 -->
      <n-modal v-model:show="showStatusConfirm" preset="dialog" :title="`确认${detail?.user.status === 'active' ? '禁用' : '启用'}用户`">
        <p>{{ detail?.user.status === 'active' ? '禁用后该用户将无法登录客户端' : '启用后该用户可以正常登录客户端' }}</p>
        <template #action>
          <n-button @click="showStatusConfirm = false">取消</n-button>
          <n-button :type="detail?.user.status === 'active' ? 'error' : 'success'" @click="toggleUserStatus">确认</n-button>
        </template>
      </n-modal>

      <!-- 编辑用户信息对话框 -->
      <n-modal v-model:show="showEditDialog" preset="card" title="编辑用户信息" style="width: 480px">
        <n-form>
          <n-form-item label="显示名称">
            <n-input v-model:value="editForm.displayName" />
          </n-form-item>
          <n-form-item label="邮箱">
            <n-input v-model:value="editForm.email" />
          </n-form-item>
          <n-form-item label="手机号">
            <n-input v-model:value="editForm.phone" />
          </n-form-item>
          <n-form-item label="角色">
            <n-select v-model:value="editForm.role" :options="roleOptions" />
          </n-form-item>
          <n-space justify="end">
            <n-button @click="showEditDialog = false">取消</n-button>
            <n-button type="primary" :loading="editLoading" @click="updateUserInfo">保存</n-button>
          </n-space>
        </n-form>
      </n-modal>

      <!-- 重置密码对话框 -->
      <n-modal v-model:show="showResetPasswordDialog" preset="card" title="重置密码" style="width: 400px">
        <n-form>
          <n-form-item label="新密码">
            <n-input v-model:value="resetPasswordForm.password" type="password" show-password-on="click" placeholder="至少6位" />
          </n-form-item>
          <n-space justify="end">
            <n-button @click="showResetPasswordDialog = false">取消</n-button>
            <n-button type="primary" :loading="resetPasswordLoading" @click="resetPassword">确认重置</n-button>
          </n-space>
        </n-form>
      </n-modal>

      <n-modal
        v-model:show="showCreditAdjustmentDialog"
        preset="card"
        :title="creditAdjustmentMode === 'add' ? '增加积分' : '减少积分'"
        style="width: 440px"
      >
        <n-form label-placement="top">
          <n-form-item label="积分数量">
            <n-input-number
              v-model:value="creditAdjustmentForm.amount"
              :min="1"
              :precision="0"
              style="width: 100%"
            />
          </n-form-item>
          <n-form-item label="调整原因">
            <n-input
              v-model:value="creditAdjustmentForm.reason"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 6 }"
              placeholder="例如：月度额度、临时补充、纠正误差"
            />
          </n-form-item>
          <n-space justify="end">
            <n-button @click="showCreditAdjustmentDialog = false">取消</n-button>
            <n-button
              :type="creditAdjustmentMode === 'add' ? 'primary' : 'warning'"
              :loading="creditAdjusting"
              @click="submitCreditAdjustment"
            >
              确认{{ creditAdjustmentMode === 'add' ? '增加' : '减少' }}
            </n-button>
          </n-space>
        </n-form>
      </n-modal>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NTag, useMessage } from 'naive-ui'
import DurationIndicator from '~/components/logs/DurationIndicator.vue'
import {
  auditActionLabel,
  auditTargetTypeLabel,
  creditTransactionTypeLabel,
  modelOperationLabel,
  modelStatusLabel,
  providerLabel,
  statusLabel,
  userRoleLabel,
  userStatusLabel
} from '@playlet-shared/utils/display-labels'

type TagType = 'default' | 'success' | 'warning' | 'error' | 'info'

const message = useMessage()

interface DetailItem {
  label: string
  value: string
  tagType?: TagType
}

interface MetricItem {
  label: string
  value: string | number
}

interface TextSection {
  title: string
  content: string
}

interface PreviewItem {
  id: string
  title: string
  subtitle?: string
  description?: string
  imageUrl?: string
  meta: string[]
}

interface AssetItem {
  id: string
  title: string
  description?: string
  kind: 'image' | 'video' | 'file'
  kindLabel: string
  url: string
  previewable: boolean
}

interface PromptProfileItem {
  id: string
  localProfileId: string
  name: string
  description: string
  active: boolean
  updatedAt: string
}

interface PromptTemplateItem {
  id: string
  templateKey: string
  title: string
  content: string
  sourceLabel: string
  sourceType: TagType
  profileName: string
  updatedAt: string
}

type ProjectStageKey = 'parse' | 'assets' | 'videos' | 'final'
type ProjectAssetTabKey = 'characters' | 'environments' | 'props' | 'others'
type ProjectStageStatus = 'pending' | 'running' | 'done'

interface ProjectStageItem {
  key: ProjectStageKey
  label: string
  status: ProjectStageStatus
}

interface ProjectAssetTabItem {
  key: ProjectAssetTabKey
  label: string
  count: number
}

interface ProjectEpisodeCard {
  id: string
  title: string
  index: number
  overview: string
  meta: string[]
  beats: Array<{ label: string, value: string }>
}

interface ProjectCharacterCard {
  id: string
  name: string
  roleLabel: string
  variantName: string
  appearance: string
  imageUrl: string
  sceneCount: number
  statusText: string
  statusClass: string
  voiceLabel: string
  voiceUrl: string
  voiceLocked: boolean
}

interface ProjectEnvironmentCard {
  id: string
  name: string
  description: string
  summary: string
  sceneTitles: string[]
  views: Array<{ label: string, image: string }>
  statusText: string
  statusType: TagType
}

interface ProjectPropCard {
  id: string
  name: string
  description: string
  imageUrl: string
  voiceUrl: string
  mediaLabel: string
  usageCount: number
  readyText: string
}

interface ProjectEpisodeDirectoryItem {
  id: string
  title: string
  index: number
  stats: string
  meta: string[]
  overview: string
}

interface ProjectSceneCard {
  id: string
  index: number
  title: string
  description: string
  narration: string
  referenceImage: string
  videoUrl: string
  referenceLabel: string
  referenceTagType: TagType
  videoLabel: string
  videoTagType: TagType
  meta: string[]
}

interface ProjectFinalSceneCard {
  id: string
  index: number
  title: string
  duration: string
  statusText: string
  tagType: TagType
}

const PROJECT_LIST_LIMIT = 20
const ASSET_LIST_LIMIT = 12
const route = useRoute()
const userId = computed(() => String(route.params.id))
const pending = ref(false)
const detail = ref<any>(null)
const projects = ref<any[]>([])
const promptState = ref<any>(null)
const promptProfiles = ref<any[]>([])
const promptTemplates = ref<any[]>([])
const preferences = ref<any[]>([])
const devices = ref<any[]>([])
const projectDrawer = ref(false)
const selectedProject = ref<any | null>(null)
const selectedProjectSnapshot = ref<any | null>(null)
const projectDrawerWidth = 'min(960px, 100vw)'
const activeProjectStage = ref<ProjectStageKey>('parse')
const activeProjectAssetTab = ref<ProjectAssetTabKey>('characters')
const selectedProjectEpisodeId = ref('')

// 项目分页
const projectsLoading = ref(false)
const projectsPage = ref(1)
const projectsPageSize = ref(20)
const projectsTotal = ref(0)

// 模型偏好分页
const preferencesLoading = ref(false)
const preferencesPage = ref(1)
const preferencesPageSize = ref(20)
const preferencesTotal = ref(0)

// 设备分页
const devicesLoading = ref(false)
const devicesPage = ref(1)
const devicesPageSize = ref(20)
const devicesTotal = ref(0)

// 用户操作相关
const showStatusConfirm = ref(false)
const showEditDialog = ref(false)
const showResetPasswordDialog = ref(false)
const showCreditAdjustmentDialog = ref(false)
const editLoading = ref(false)
const resetPasswordLoading = ref(false)
const creditAdjusting = ref(false)
const editForm = reactive({
  displayName: '',
  email: '',
  phone: '',
  role: 'user'
})
const resetPasswordForm = reactive({
  password: ''
})
const creditAdjustmentMode = ref<'add' | 'deduct'>('add')
const creditAdjustmentForm = reactive<{ amount: number | null, reason: string }>({
  amount: null,
  reason: ''
})

const creditAccount = ref({ balance: 0, totalAdded: 0, totalConsumed: 0, transactionCount: 0 })
const creditTransactions = ref<any[]>([])
const creditsLoading = ref(false)
const creditsPage = ref(1)
const creditsPageSize = ref(20)
const creditsTotal = ref(0)
const creditTransactionType = ref('')
const creditDateRange = ref<[number, number] | null>(null)
const creditPeriod = ref({ added: 0, deducted: 0, consumed: 0, transactionCount: 0 })
const creditTransactionTypeOptions = [
  { label: '管理员增加', value: 'admin_add' },
  { label: '管理员减少', value: 'admin_deduct' },
  { label: '模型调用', value: 'model_call' }
]
const roleOptions = [
  { label: '普通用户', value: 'user' },
  { label: '管理员', value: 'admin' }
]

// 调用日志相关
const logs = ref<any[]>([])
const logsLoading = ref(false)
const logsKeyword = ref('')
const logsProvider = ref('')
const logsStatus = ref('')
const logsPage = ref(1)
const logsPageSize = ref(20)
const logsTotal = ref(0)
const providerOptions = [
  { label: 'Gemini', value: 'gemini' },
  { label: '通义', value: 'qwen' },
  { label: '火山', value: 'volcengine' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Kling', value: 'kling' }
]
const statusOptions = [
  { label: '成功', value: 'success' },
  { label: '失败', value: 'error' }
]

// 审计日志相关
const auditLogs = ref<any[]>([])
const auditLoading = ref(false)
const auditKeyword = ref('')
const auditPage = ref(1)
const auditPageSize = ref(20)
const auditTotal = ref(0)

const selectedProjectData = computed(() => toRecord(selectedProjectSnapshot.value?.data))
const selectedProjectSnapshotProject = computed(() => toRecord(selectedProjectData.value.project))
const selectedProjectScript = computed(() => toRecord(selectedProjectData.value.script))
const selectedProjectSummary = computed(() => toRecord(selectedProject.value?.summary))
const rawProjectScenes = computed(() => normalizeArray(firstPresent(selectedProjectData.value, ['scenes', 'sceneList'])))
const rawProjectCharacters = computed(() => normalizeArray(firstPresent(selectedProjectData.value, ['characters', 'characterList'])))
const rawProjectEpisodes = computed(() => normalizeArray(
  firstPresent(selectedProjectScript.value, ['episodePlan', 'episodes'])
    || firstPresent(selectedProjectData.value, ['episodePlan', 'episodes'])
))

const projectDescription = computed(() => {
  return firstText(selectedProjectSnapshotProject.value, ['description'])
    || firstText(selectedProject.value, ['description'])
})

const projectInfoItems = computed<DetailItem[]>(() => {
  const snapshotProject = selectedProjectSnapshotProject.value
  const project = toRecord(selectedProject.value)
  const status = firstText(snapshotProject, ['status']) || firstText(project, ['status'])
  return [
    {
      label: '名称',
      value: firstText(snapshotProject, ['name', 'title']) || firstText(project, ['name', 'title']) || '-'
    },
    {
      label: '状态',
      value: status || '-',
      tagType: projectStatusTagType(status)
    },
    {
      label: '风格',
      value: firstText(snapshotProject, ['styleId', 'style_id']) || firstText(project, ['style_id', 'styleId']) || '-'
    },
    {
      label: '画幅',
      value: firstText(snapshotProject, ['aspectRatio', 'aspect_ratio']) || firstText(project, ['aspect_ratio', 'aspectRatio']) || '-'
    },
    {
      label: '解析模式',
      value: scriptParseModeLabel(firstText(snapshotProject, ['scriptParseMode', 'script_parse_mode']) || firstText(project, ['script_parse_mode', 'scriptParseMode']))
    },
    {
      label: '本地项目 ID',
      value: firstText(project, ['local_project_id', 'localProjectId']) || firstText(snapshotProject, ['id']) || '-'
    },
    {
      label: '本地创建',
      value: formatAdminDateTime(firstPresent(project, ['local_created_at', 'createdAt', 'created_at']))
    },
    {
      label: '本地更新',
      value: formatAdminDateTime(firstPresent(project, ['local_updated_at', 'updatedAt', 'updated_at']))
    },
    {
      label: '最后同步',
      value: formatAdminDateTime(project.last_synced_at)
    },
    {
      label: '快照',
      value: selectedProjectSnapshot.value?.version ? `v${selectedProjectSnapshot.value.version}` : '-'
    },
    {
      label: '快照时间',
      value: formatAdminDateTime(selectedProjectSnapshot.value?.createdAt)
    }
  ]
})

const projectMetricItems = computed<MetricItem[]>(() => {
  const sceneCount = rawProjectScenes.value.length || numberFromSummary('sceneCount')
  const characterCount = rawProjectCharacters.value.length || numberFromSummary('characterCount')
  return [
    { label: '场景', value: sceneCount },
    { label: '角色', value: characterCount },
    { label: '分集', value: rawProjectEpisodes.value.length },
    { label: '素材', value: allProjectAssetItems.value.length },
    { label: '总时长', value: formatProjectDuration(projectTotalDuration.value) }
  ]
})

const projectTotalDuration = computed(() => {
  const explicitDuration = Number(firstPresent(selectedProjectScript.value, ['totalDuration', 'duration']))
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) return explicitDuration
  return rawProjectScenes.value.reduce((total: number, scene) => {
    const duration = Number(firstPresent(scene, ['duration', 'seconds']))
    return Number.isFinite(duration) ? total + duration : total
  }, 0)
})

const projectTextSections = computed<TextSection[]>(() => {
  const sections: TextSection[] = []
  pushTextSection(sections, '故事梗概', firstPresent(selectedProjectScript.value, ['storyIdea', 'summary']))
  pushTextSection(sections, '原始输入', firstPresent(selectedProjectScript.value, ['rawText', 'novelText']))
  pushTextSection(sections, '解析摘要', firstPresent(toRecord(selectedProjectScript.value.parsedData), ['summary', 'storyIdea', 'outline']))
  return sections
})

const projectEpisodeItems = computed<PreviewItem[]>(() => rawProjectEpisodes.value.map((item, index) => {
  const record = toRecord(item)
  const duration = firstPresent(record, ['duration', 'totalDuration'])
  return {
    id: firstText(record, ['id', 'episodeId']) || `episode-${index}`,
    title: firstText(record, ['title', 'name', 'episodeTitle']) || `第 ${index + 1} 集`,
    description: firstText(record, ['summary', 'description', 'story', 'outline']),
    meta: [
      firstText(record, ['episodeIndex', 'index']) ? `序号 ${firstText(record, ['episodeIndex', 'index'])}` : '',
      duration ? formatProjectDuration(Number(duration)) : '',
      firstText(record, ['sceneCount']) ? `${firstText(record, ['sceneCount'])} 个场景` : ''
    ].filter(Boolean)
  }
}))

const allProjectCharacterItems = computed<PreviewItem[]>(() => rawProjectCharacters.value.map((item, index) => {
  const record = toRecord(item)
  const title = firstText(record, ['name', 'title']) || `角色 ${index + 1}`
  const role = firstText(record, ['role', 'variantName'])
  return {
    id: firstText(record, ['id']) || `character-${index}`,
    title,
    subtitle: role,
    imageUrl: previewableMediaUrl(firstText(record, ['imageUrl', 'baseImage'])),
    description: firstText(record, ['appearance', 'personality', 'background']),
    meta: [
      firstText(record, ['gender']),
      firstText(record, ['age']) ? `${firstText(record, ['age'])} 岁` : '',
      firstText(record, ['voiceTone']),
      firstText(record, ['catchphrase']) ? `口头禅：${firstText(record, ['catchphrase'])}` : ''
    ].filter(Boolean)
  }
}))
const projectCharacterItems = computed(() => allProjectCharacterItems.value.slice(0, PROJECT_LIST_LIMIT))
const projectCharacterRemainder = computed(() => Math.max(0, allProjectCharacterItems.value.length - projectCharacterItems.value.length))

const allProjectSceneItems = computed<PreviewItem[]>(() => rawProjectScenes.value.map((item, index) => {
  const record = toRecord(item)
  const episode = firstText(record, ['episodeTitle'])
  const duration = Number(firstPresent(record, ['duration', 'seconds']))
  return {
    id: firstText(record, ['id']) || `scene-${index}`,
    title: firstText(record, ['title', 'name']) || `场景 ${index + 1}`,
    subtitle: episode || (firstText(record, ['episodeIndex']) ? `第 ${firstText(record, ['episodeIndex'])} 集` : ''),
    description: firstText(record, ['description', 'narration']),
    meta: [
      Number.isFinite(duration) && duration > 0 ? formatProjectDuration(duration) : '',
      firstText(record, ['shotType']),
      firstText(record, ['cameraMovement']),
      firstText(record, ['environmentCaptureMode']),
      firstText(record, ['status', 'videoStatus', 'referenceStatus'])
    ].filter(Boolean)
  }
}))
const projectSceneItems = computed(() => allProjectSceneItems.value.slice(0, PROJECT_LIST_LIMIT))
const projectSceneRemainder = computed(() => Math.max(0, allProjectSceneItems.value.length - projectSceneItems.value.length))

const allProjectAssetItems = computed<AssetItem[]>(() => {
  const items: AssetItem[] = []
  collectExplicitAssets(items)
  collectSceneAssets(items)
  collectCharacterAssets(items)
  return dedupeAssetItems(items)
})
const projectAssetItems = computed(() => allProjectAssetItems.value.slice(0, ASSET_LIST_LIMIT))
const projectAssetRemainder = computed(() => Math.max(0, allProjectAssetItems.value.length - projectAssetItems.value.length))

const hasProjectVisualContent = computed(() => {
  return Boolean(
    projectDescription.value
    || projectTextSections.value.length
    || projectEpisodeItems.value.length
    || allProjectCharacterItems.value.length
    || allProjectSceneItems.value.length
    || allProjectAssetItems.value.length
  )
})

const projectWorkbenchTitle = computed(() => {
  return firstText(selectedProjectSnapshotProject.value, ['name', 'title'])
    || firstText(selectedProject.value, ['name', 'title'])
    || 'AI 视频创作工作台'
})

const projectWorkbenchStyle = computed(() => {
  return firstText(selectedProjectSnapshotProject.value, ['styleId', 'style_id'])
    || firstText(selectedProject.value, ['style_id', 'styleId'])
    || '未选择'
})

const projectWorkbenchAspectRatio = computed(() => {
  return firstText(selectedProjectSnapshotProject.value, ['aspectRatio', 'aspect_ratio'])
    || firstText(selectedProject.value, ['aspect_ratio', 'aspectRatio'])
    || '-'
})

const projectWorkbenchParseMode = computed(() => {
  return firstText(selectedProjectSnapshotProject.value, ['scriptParseMode', 'script_parse_mode'])
    || firstText(selectedProject.value, ['script_parse_mode', 'scriptParseMode'])
})

const projectAssetWorkflow = computed(() => toRecord(
  firstPresent(selectedProjectScript.value, ['assetWorkflow'])
    || firstPresent(selectedProjectSnapshotProject.value, ['assetWorkflow'])
    || firstPresent(selectedProjectData.value, ['assetWorkflow'])
))

const projectSceneConfigs = computed(() => toRecord(projectAssetWorkflow.value.sceneConfigs))
const projectEnvironmentPanoramaStates = computed(() => toRecord(projectAssetWorkflow.value.environmentPanoramaStates))
const projectFinalVideo = computed(() => normalizeFinalVideo(
  firstPresent(projectAssetWorkflow.value, ['finalVideo'])
    || firstPresent(selectedProjectData.value, ['finalVideo'])
))

const projectNovelText = computed(() => {
  return firstText(selectedProjectScript.value, ['rawText', 'novelText'])
    || firstText(selectedProjectScript.value, ['storyIdea'])
})

const projectNovelStats = computed(() => {
  const text = projectNovelText.value
  if (!text) return '0 字 · 0 行'
  return `${text.length} 字 · ${text.split(/\r?\n/).length} 行`
})

const projectEpisodeCards = computed<ProjectEpisodeCard[]>(() => rawProjectEpisodes.value.map((item, index) => {
  const record = toRecord(item)
  const title = firstText(record, ['title', 'name', 'episodeTitle']) || `第${index + 1}集`
  const normalizedIndex = normalizedEpisodeIndex(record, index)
  const sceneCount = resolveEpisodeSceneCount(firstText(record, ['id', 'episodeId']), normalizedIndex)
  return {
    id: firstText(record, ['id', 'episodeId']) || `episode-${normalizedIndex}`,
    title,
    index: normalizedIndex,
    overview: firstText(record, ['overview', 'summary', 'description', 'story', 'outline']),
    meta: [
      firstPresent(record, ['startOffset']) !== undefined && firstPresent(record, ['endOffset']) !== undefined
        ? `范围 ${firstText(record, ['startOffset'])} - ${firstText(record, ['endOffset'])}`
        : '',
      firstText(record, ['charCount']) ? `约 ${firstText(record, ['charCount'])} 字` : '',
      sceneCount > 0 ? `${sceneCount} 个场景` : '',
      formatEpisodeAssets(record)
    ].filter(Boolean),
    beats: [
      { label: '钩子', value: firstText(record, ['episodeHook', 'hook']) },
      { label: '压迫点', value: firstText(record, ['humiliationOrThreat', 'threat']) },
      { label: '反击点', value: firstText(record, ['reversalPoint']) },
      { label: '情绪曲线', value: firstText(record, ['emotionalCurve']) },
      { label: '结尾悬念', value: firstText(record, ['cliffhanger']) }
    ].filter(item => item.value)
  }
}))

const projectCharacterReadyCount = computed(() => projectCharacterCards.value.filter(character => !!character.imageUrl).length)
const projectCharacterMissingCount = computed(() => Math.max(projectCharacterCards.value.length - projectCharacterReadyCount.value, 0))
const assetReadyDotClass = computed(() => projectCharacterMissingCount.value === 0 ? 'dot--green' : 'dot--amber')

const projectCharacterCards = computed<ProjectCharacterCard[]>(() => rawProjectCharacters.value.map((item, index) => {
  const record = toRecord(item)
  const id = firstText(record, ['id']) || `character-${index}`
  const imageUrl = previewableMediaUrl(firstText(record, ['imageUrl', 'baseImage']))
  const voiceAsset = toRecord(record.voiceAsset)
  const voiceUrl = firstText(voiceAsset, ['audioUrl', 'url'])
  const isGenerating = record.generating === true
  return {
    id,
    name: firstText(record, ['name', 'title']) || `角色 ${index + 1}`,
    roleLabel: resolveCharacterRoleLabel(firstText(record, ['role'])),
    variantName: firstText(record, ['variantName']),
    appearance: firstText(record, ['appearance', 'personality', 'background']),
    imageUrl,
    sceneCount: countScenesForCharacter(firstText(record, ['name'])),
    statusText: isGenerating ? '生成中' : imageUrl ? '已就绪' : '待生成',
    statusClass: isGenerating ? 'status-dot--running' : imageUrl ? 'status-dot--done' : 'status-dot--pending',
    voiceLabel: voiceUrl ? (voiceAsset.sourceSceneId || voiceAsset.sourceTaskId ? '自动提取' : '手动上传') : '暂无参考音频',
    voiceUrl,
    voiceLocked: voiceAsset.locked === true
  }
}))

const projectEnvironmentCards = computed<ProjectEnvironmentCard[]>(() => {
  const map = new Map<string, {
    id: string
    name: string
    description: string
    sceneTitles: string[]
    singleViewImage: string
    fourViewImage: string
    panoramaImage: string
    referenceImage: string
    status: string
  }>()

  rawProjectScenes.value.forEach((scene, index) => {
    const record = toRecord(scene)
    const sceneId = firstText(record, ['id']) || `scene-${index}`
    const configuredId = firstText(toRecord(projectSceneConfigs.value[sceneId]), ['environmentAssetId'])
    const assetId = configuredId || resolveSceneEnvironmentAssetId(record)
    const setting = toRecord(record.setting)
    const name = resolveEnvironmentAssetLabel(assetId, setting)
    const panoramaState = resolveEnvironmentState(assetId, record)
    const referenceImage = sceneReferenceImage(record)
    const existing = map.get(assetId)
    const nextStatus = sceneReferenceStatus(record)
    if (!existing) {
      map.set(assetId, {
        id: assetId,
        name,
        description: firstText(setting, ['mood']) || firstText(record, ['description']),
        sceneTitles: [firstText(record, ['title', 'name']) || sceneId],
        singleViewImage: firstText(panoramaState, ['singleViewImage']) || referenceImage,
        fourViewImage: firstText(panoramaState, ['fourViewImage']),
        panoramaImage: firstText(panoramaState, ['panoramaImage']),
        referenceImage,
        status: nextStatus
      })
      return
    }

    existing.sceneTitles.push(firstText(record, ['title', 'name']) || sceneId)
    existing.description ||= firstText(setting, ['mood']) || firstText(record, ['description'])
    existing.singleViewImage ||= firstText(panoramaState, ['singleViewImage']) || referenceImage
    existing.fourViewImage ||= firstText(panoramaState, ['fourViewImage'])
    existing.panoramaImage ||= firstText(panoramaState, ['panoramaImage'])
    existing.referenceImage ||= referenceImage
    existing.status = mergeVisualStatus(existing.status, nextStatus)
  })

  return Array.from(map.values()).map((asset) => {
    const status = asset.referenceImage || asset.singleViewImage || asset.fourViewImage || asset.panoramaImage
      ? 'done'
      : asset.status
    return {
      id: asset.id,
      name: asset.name,
      description: asset.description,
      summary: asset.sceneTitles.length <= 2
        ? `覆盖场景：${asset.sceneTitles.join('、')}`
        : `覆盖场景：${asset.sceneTitles.slice(0, 2).join('、')} 等 ${asset.sceneTitles.length} 场`,
      sceneTitles: asset.sceneTitles,
      views: [
        { label: '单视图', image: previewableMediaUrl(asset.singleViewImage || asset.referenceImage) },
        { label: '四视图', image: previewableMediaUrl(asset.fourViewImage || asset.panoramaImage) }
      ],
      statusText: visualStatusLabel(status),
      statusType: visualStatusTagType(status)
    }
  })
})

const projectPropCards = computed<ProjectPropCard[]>(() => projectWorkflowPropCards('prop'))
const projectOtherAssetCards = computed<ProjectPropCard[]>(() => projectWorkflowPropCards('other'))
const activeReadonlyPropCards = computed(() => activeProjectAssetTab.value === 'props' ? projectPropCards.value : projectOtherAssetCards.value)

const projectAssetTabs = computed<ProjectAssetTabItem[]>(() => [
  { key: 'characters', label: '角色', count: projectCharacterCards.value.length },
  { key: 'environments', label: '环境', count: projectEnvironmentCards.value.length },
  { key: 'props', label: '道具', count: projectPropCards.value.length },
  { key: 'others', label: '其他素材', count: projectOtherAssetCards.value.length }
])

const projectVideoDoneCount = computed(() => rawProjectScenes.value.filter(scene => sceneVideoStatus(toRecord(scene)) === 'done').length)
const projectVideoErrorCount = computed(() => rawProjectScenes.value.filter(scene => sceneVideoStatus(toRecord(scene)) === 'error').length)
const projectReadySceneCount = computed(() => rawProjectScenes.value.filter(scene => sceneReferenceStatus(toRecord(scene)) === 'done').length)

const projectStageItems = computed<ProjectStageItem[]>(() => [
  {
    key: 'parse',
    label: '剧本解析',
    status: projectNovelText.value || projectEpisodeCards.value.length || rawProjectScenes.value.length ? 'done' : 'pending'
  },
  {
    key: 'assets',
    label: '资产准备',
    status: projectAssetStageStatus()
  },
  {
    key: 'videos',
    label: '分镜视频',
    status: projectVideoStageStatus()
  },
  {
    key: 'final',
    label: '成片导出',
    status: projectFinalVideo.value ? 'done' : 'pending'
  }
])

const projectEpisodeDirectoryItems = computed<ProjectEpisodeDirectoryItem[]>(() => {
  if (projectEpisodeCards.value.length > 0) {
    return projectEpisodeCards.value.map((episode) => {
      const sceneCount = resolveEpisodeSceneCount(episode.id, episode.index)
      const doneCount = resolveEpisodeDoneCount(episode.id, episode.index)
      const duration = resolveEpisodeDuration(episode.id, episode.index)
      return {
        id: episode.id,
        title: episode.title,
        index: episode.index,
        stats: `${sceneCount} 场 · ${doneCount} 完成 · ${formatProjectDuration(duration)}`,
        meta: episode.meta,
        overview: episode.overview
      }
    })
  }

  return projectSceneEpisodeGroups.value.map(group => ({
    id: group.id,
    title: group.title,
    index: group.index,
    stats: `${group.scenes.length} 场 · ${group.doneCount} 完成 · ${formatProjectDuration(group.duration)}`,
    meta: [`${group.scenes.length} 个场景`, `视频完成 ${group.doneCount}`],
    overview: ''
  }))
})

const currentProjectEpisodeId = computed(() => {
  return selectedProjectEpisodeId.value || projectEpisodeDirectoryItems.value[0]?.id || ''
})

const selectedProjectEpisodeInfo = computed(() => {
  return projectEpisodeDirectoryItems.value.find(item => item.id === currentProjectEpisodeId.value) || null
})

const selectedProjectEpisodeScenes = computed<ProjectSceneCard[]>(() => {
  const target = selectedProjectEpisodeInfo.value
  if (!target) return projectSceneCards.value
  return projectSceneCards.value.filter(scene => scene.episodeId === target.id || scene.episodeIndex === target.index)
})

const projectSceneListHeader = computed(() => {
  const episode = selectedProjectEpisodeInfo.value
  if (!episode) return '场景列表'
  return `当前分集场景列表（第${episode.index}集，${episode.stats}）`
})

const projectSceneCards = computed<Array<ProjectSceneCard & { episodeId: string, episodeIndex: number }>>(() => {
  return rawProjectScenes.value.map((item, index) => {
    const record = toRecord(item)
    const referenceStatus = sceneReferenceStatus(record)
    const videoStatus = sceneVideoStatus(record)
    const duration = Number(firstPresent(record, ['duration', 'seconds']))
    const episodeIndex = Number(firstPresent(record, ['episodeIndex']))
    return {
      id: firstText(record, ['id']) || `scene-${index}`,
      index,
      episodeId: firstText(record, ['episodeId']) || `episode_${String(Number.isFinite(episodeIndex) ? episodeIndex : 1).padStart(3, '0')}`,
      episodeIndex: Number.isFinite(episodeIndex) && episodeIndex > 0 ? episodeIndex : 1,
      title: firstText(record, ['title', 'name']) || `场景 ${index + 1}`,
      description: firstText(record, ['description']),
      narration: firstText(record, ['narration']),
      referenceImage: previewableMediaUrl(sceneReferenceImage(record)),
      videoUrl: previewableMediaUrl(firstText(record, ['videoUrl'])),
      referenceLabel: referenceStatus === 'done' ? '环境图就绪' : referenceStatus === 'error' ? '环境图失败' : referenceStatus === 'generating' ? '环境图生成中' : '环境图待生成',
      referenceTagType: visualStatusTagType(referenceStatus),
      videoLabel: videoStatus === 'done' ? '视频完成' : videoStatus === 'error' ? '视频失败' : videoStatus === 'generating' ? '视频生成中' : '视频待生成',
      videoTagType: visualStatusTagType(videoStatus),
      meta: [
        Number.isFinite(duration) && duration > 0 ? formatProjectDuration(duration) : '',
        firstText(record, ['shotType']),
        firstText(record, ['cameraMovement']),
        formatSettingText(record),
        formatSceneCharacters(record)
      ].filter(Boolean)
    }
  })
})

const projectSceneEpisodeGroups = computed(() => {
  const map = new Map<string, {
    id: string
    title: string
    index: number
    scenes: Array<ProjectSceneCard & { episodeId: string, episodeIndex: number }>
    doneCount: number
    duration: number
  }>()
  for (const scene of projectSceneCards.value) {
    const id = scene.episodeId || `episode-${scene.episodeIndex}`
    let group = map.get(id)
    if (!group) {
      group = {
        id,
        title: firstText(rawProjectScenes.value[scene.index], ['episodeTitle']) || `第${scene.episodeIndex}集`,
        index: scene.episodeIndex,
        scenes: [],
        doneCount: 0,
        duration: 0
      }
      map.set(id, group)
    }
    group.scenes.push(scene)
    if (scene.videoTagType === 'success') group.doneCount += 1
    group.duration += Number(firstPresent(rawProjectScenes.value[scene.index], ['duration', 'seconds'])) || 0
  }
  return Array.from(map.values()).sort((a, b) => a.index - b.index)
})

const projectFinalSceneCards = computed<ProjectFinalSceneCard[]>(() => projectSceneCards.value.map(scene => ({
  id: scene.id,
  index: scene.index,
  title: scene.title,
  duration: scene.meta.find(item => item.includes('秒') || item.includes('分')) || '-',
  statusText: scene.videoLabel,
  tagType: scene.videoTagType
})))

const projectFinalOptions = computed(() => {
  const mergeOptions = toRecord(firstPresent(projectAssetWorkflow.value, ['mergeOptions', 'finalMergeOptions']))
  return {
    transitionType: transitionLabel(firstText(mergeOptions, ['transitionType']) || 'none'),
    transitionDuration: firstText(mergeOptions, ['transitionDuration']) ? `${firstText(mergeOptions, ['transitionDuration'])} 秒` : '-',
    addSubtitles: mergeOptions.addSubtitles === true ? '开启' : '关闭',
    bgmUrl: firstText(mergeOptions, ['bgmUrl']) || '-',
    bgmVolume: firstText(mergeOptions, ['bgmVolume']) || '-'
  }
})

const promptMetricItems = computed<MetricItem[]>(() => [
  { label: '配置方案', value: promptProfileItems.value.length },
  { label: '模板', value: promptTemplateItems.value.length },
  { label: '当前方案', value: activePromptProfileName.value || '-' },
  { label: '更新时间', value: formatAdminDateTime(promptState.value?.updatedAt) }
])

const promptProfileItems = computed<PromptProfileItem[]>(() => {
  const rows = promptProfiles.value.length ? promptProfiles.value : snapshotPromptProfiles()
  return rows.map((row, index) => {
    const record = toRecord(row)
    const localProfileId = firstText(record, ['local_profile_id', 'localProfileId', 'id']) || `profile-${index}`
    return {
      id: firstText(record, ['id']) || localProfileId,
      localProfileId,
      name: firstText(record, ['name', 'title']) || localProfileId,
      description: firstText(record, ['description']),
      active: Boolean(record.is_active) || record.isActive === true || activePromptProfileId.value === localProfileId,
      updatedAt: formatAdminDateTime(firstPresent(record, ['updated_at', 'updatedAt', 'created_at', 'createdAt']))
    }
  })
})

const activePromptProfileId = computed(() => {
  const snapshot = toRecord(promptState.value?.snapshot)
  return firstText(snapshot, ['activeProfileId', 'active_profile_id'])
    || firstText(promptProfiles.value.find(item => Boolean(toRecord(item).is_active)), ['local_profile_id', 'localProfileId', 'id'])
})

const activePromptProfileName = computed(() => {
  return promptProfileItems.value.find(item => item.active)?.name || ''
})

const promptTemplateItems = computed<PromptTemplateItem[]>(() => {
  const rows = promptTemplates.value.length ? promptTemplates.value : snapshotPromptTemplates()
  const profileNameById = new Map<string, string>()
  for (const profile of promptProfileItems.value) {
    profileNameById.set(profile.id, profile.name)
    profileNameById.set(profile.localProfileId, profile.name)
  }

  return rows.map((row, index) => {
    const record = toRecord(row)
    const key = firstText(record, ['template_key', 'templateKey', 'key', 'id']) || `template-${index}`
    const source = firstText(record, ['source']) || (record.isCustomized === true ? 'user_custom' : 'system_default')
    return {
      id: firstText(record, ['id', 'local_template_id', 'localTemplateId']) || key,
      templateKey: key,
      title: firstText(record, ['title', 'name']) || key,
      content: normalizePromptContent(firstText(record, ['content'])),
      sourceLabel: promptSourceLabel(source),
      sourceType: promptSourceTagType(source),
      profileName: profileNameById.get(firstText(record, ['profile_id', 'profileId', 'localProfileId'])) || '',
      updatedAt: formatAdminDateTime(firstPresent(record, ['updated_at', 'updatedAt', 'created_at', 'createdAt']))
    }
  })
})

const projectColumns = [
  { title: '名称', key: 'name' },
  {
    title: '状态',
    key: 'status',
    render(row: any) {
      return h(NTag, { size: 'small', type: projectStatusTagType(row.status) }, { default: () => statusLabel(row.status) })
    }
  },
  {
    title: '风格',
    key: 'style_id',
    render(row: any) {
      return displayValue(row.style_id)
    }
  },
  {
    title: '画幅',
    key: 'aspect_ratio',
    render(row: any) {
      return displayValue(row.aspect_ratio)
    }
  },
  {
    title: '同步时间',
    key: 'last_synced_at',
    width: 180,
    render(row: any) {
      return formatAdminDateTime(row.last_synced_at)
    }
  }
]

const preferenceColumns = [
  { title: '业务步骤', key: 'workflow_step' },
  { title: '模型', key: 'model_id' },
  {
    title: '参数',
    key: 'modelOptions',
    render(row: any) {
      return h('span', { class: 'mono' }, JSON.stringify(row.modelOptions || {}))
    }
  },
  {
    title: '更新时间',
    key: 'updated_at',
    width: 180,
    render(row: any) {
      return formatAdminDateTime(row.updated_at)
    }
  }
]

const deviceColumns = [
  { title: '设备 ID', key: 'device_id', width: 200 },
  { title: '名称', key: 'device_name' },
  { title: '系统', key: 'os', width: 100 },
  { title: '版本', key: 'client_version', width: 100 },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.status === 'active' ? 'success' : 'error' }, { default: () => userStatusLabel(row.status) })
    }
  },
  {
    title: '最后在线',
    key: 'last_seen_at',
    width: 180,
    render(row: any) {
      return formatAdminDateTime(row.last_seen_at)
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 180,
    render(row: any) {
      return h('div', { style: { display: 'flex', gap: '8px' } }, [
        h(
          NButton,
          {
            size: 'small',
            type: row.status === 'active' ? 'error' : 'success',
            onClick: () => updateDeviceStatus(row)
          },
          { default: () => row.status === 'active' ? '禁用' : '启用' }
        ),
        h(
          NButton,
          {
            size: 'small',
            type: 'error',
            onClick: () => deleteDevice(row)
          },
          { default: () => '删除' }
        )
      ])
    }
  }
]

const logColumns = [
  { title: '请求ID', key: 'request_id', width: 180, ellipsis: { tooltip: true } },
  { title: '供应商', key: 'provider', width: 100, render: (row: any) => providerLabel(row.provider) },
  { title: '模型', key: 'model_id', width: 150, ellipsis: { tooltip: true } },
  { title: '操作', key: 'operation', width: 120, render: (row: any) => modelOperationLabel(row.operation) },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.status === 'success' ? 'success' : 'error' }, { default: () => modelStatusLabel(row.status) })
    }
  },
  {
    title: '耗时',
    key: 'duration_ms',
    width: 136,
    render(row: any) {
      return h(DurationIndicator, { value: row.duration_ms })
    }
  },
  {
    title: '积分',
    key: 'credits_charged',
    width: 100,
    render(row: any) {
      return row.credits_charged || '-'
    }
  },
  {
    title: '错误信息',
    key: 'error_message',
    ellipsis: { tooltip: true },
    render(row: any) {
      return row.error_message || '-'
    }
  },
  {
    title: '时间',
    key: 'created_at',
    width: 180,
    render(row: any) {
      return formatAdminDateTime(row.created_at)
    }
  }
]

const creditColumns = [
  {
    title: '类型',
    key: 'type',
    width: 120,
    render(row: any) {
      return creditTransactionTypeLabel(row.type)
    }
  },
  {
    title: '变动',
    key: 'amount',
    width: 100,
    render(row: any) {
      return h(
        NTag,
        { size: 'small', type: row.amount > 0 ? 'success' : 'warning' },
        { default: () => row.amount > 0 ? `+${row.amount}` : String(row.amount) }
      )
    }
  },
  { title: '变动后余额', key: 'balance_after', width: 120 },
  { title: '原因', key: 'reason', ellipsis: { tooltip: true } },
  { title: '操作', key: 'operation', width: 130, render: (row: any) => modelOperationLabel(row.operation) },
  { title: '模型', key: 'model_id', width: 160, ellipsis: { tooltip: true }, render: (row: any) => row.model_id || '-' },
  {
    title: '时间',
    key: 'created_at',
    width: 180,
    render(row: any) {
      return formatAdminDateTime(row.created_at)
    }
  }
]

const auditColumns = [
  { title: 'ID', key: 'id', width: 80 },
  {
    title: '操作者',
    key: 'actor',
    width: 150,
    render(row: any) {
      return row.actor_display_name || row.actor_account || '-'
    }
  },
  { title: '操作类型', key: 'action', width: 200, render: (row: any) => auditActionLabel(row.action) },
  { title: '目标类型', key: 'target_type', width: 120, render: (row: any) => auditTargetTypeLabel(row.target_type) },
  { title: '目标ID', key: 'target_id', width: 150, ellipsis: { tooltip: true } },
  {
    title: 'IP',
    key: 'ip',
    width: 140,
    render(row: any) {
      return row.ip || '-'
    }
  },
  {
    title: '时间',
    key: 'created_at',
    width: 180,
    render(row: any) {
      return formatAdminDateTime(row.created_at)
    }
  }
]

const logsPagination = computed(() => ({
  page: logsPage.value,
  pageSize: logsPageSize.value,
  pageCount: Math.ceil(logsTotal.value / logsPageSize.value),
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100]
}))

const creditsPagination = computed(() => ({
  page: creditsPage.value,
  pageSize: creditsPageSize.value,
  pageCount: Math.ceil(creditsTotal.value / creditsPageSize.value),
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100]
}))

const auditPagination = computed(() => ({
  page: auditPage.value,
  pageSize: auditPageSize.value,
  pageCount: Math.ceil(auditTotal.value / auditPageSize.value),
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100]
}))

const projectsPagination = computed(() => ({
  page: projectsPage.value,
  pageSize: projectsPageSize.value,
  pageCount: Math.ceil(projectsTotal.value / projectsPageSize.value),
  showSizePicker: true,
  pageSizes: [10, 20, 50]
}))

const preferencesPagination = computed(() => ({
  page: preferencesPage.value,
  pageSize: preferencesPageSize.value,
  pageCount: Math.ceil(preferencesTotal.value / preferencesPageSize.value),
  showSizePicker: true,
  pageSizes: [10, 20, 50]
}))

const devicesPagination = computed(() => ({
  page: devicesPage.value,
  pageSize: devicesPageSize.value,
  pageCount: Math.ceil(devicesTotal.value / devicesPageSize.value),
  showSizePicker: true,
  pageSizes: [10, 20, 50]
}))

async function load() {
  pending.value = true
  try {
    const [detailResponse, promptsResponse] = await Promise.all([
      $fetch<any>(`/api/admin/users/${userId.value}`),
      $fetch<any>(`/api/admin/users/${userId.value}/prompts`)
    ])
    detail.value = detailResponse.data
    creditAccount.value = detailResponse.data.stats.credits || creditAccount.value
    promptState.value = promptsResponse.data.state
    promptProfiles.value = promptsResponse.data.profiles || []
    promptTemplates.value = promptsResponse.data.templates || []

    // 填充编辑表单
    if (detail.value?.user) {
      editForm.displayName = detail.value.user.display_name || ''
      editForm.email = detail.value.user.email || ''
      editForm.phone = detail.value.user.phone || ''
      editForm.role = detail.value.user.role || 'user'
    }
  } finally {
    pending.value = false
  }
}

async function loadCredits() {
  creditsLoading.value = true
  try {
    const dateQuery = creditDateQuery()
    const response = await $fetch<any>(`/api/admin/users/${userId.value}/credits`, {
      query: {
        page: creditsPage.value,
        pageSize: creditsPageSize.value,
        type: creditTransactionType.value,
        ...dateQuery
      }
    })
    creditAccount.value = response.data.account
    creditTransactions.value = response.data.transactions
    creditPeriod.value = response.data.period
    creditsTotal.value = Number(response.data.pagination.total)
  } catch (err: any) {
    message.error(err.message || '加载积分流水失败')
  } finally {
    creditsLoading.value = false
  }
}

function formatLocalDate(timestamp: number) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function creditDateQuery(): Record<string, string> {
  if (!creditDateRange.value) return {}
  return {
    startDate: formatLocalDate(creditDateRange.value[0]),
    endDate: formatLocalDate(creditDateRange.value[1])
  }
}

function refreshCredits() {
  creditsPage.value = 1
  void loadCredits()
}

function exportCredits() {
  if (!import.meta.client) return
  const query = new URLSearchParams({
    type: creditTransactionType.value,
    ...creditDateQuery()
  })
  window.location.href = `/api/admin/users/${userId.value}/credits/export?${query.toString()}`
}

function handleCreditsPageChange(page: number) {
  creditsPage.value = page
  void loadCredits()
}

function handleCreditsPageSizeChange(pageSize: number) {
  creditsPageSize.value = pageSize
  creditsPage.value = 1
  void loadCredits()
}

function openCreditAdjustment(mode: 'add' | 'deduct') {
  creditAdjustmentMode.value = mode
  creditAdjustmentForm.amount = null
  creditAdjustmentForm.reason = ''
  showCreditAdjustmentDialog.value = true
}

async function submitCreditAdjustment() {
  const amount = Number(creditAdjustmentForm.amount)
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    message.warning('请输入大于 0 的整数积分')
    return
  }
  if (!creditAdjustmentForm.reason.trim()) {
    message.warning('请填写调整原因')
    return
  }
  creditAdjusting.value = true
  try {
    await $fetch(`/api/admin/users/${userId.value}/credits`, {
      method: 'POST',
      body: {
        amount: creditAdjustmentMode.value === 'add' ? amount : -amount,
        reason: creditAdjustmentForm.reason
      }
    })
    message.success('积分已调整')
    showCreditAdjustmentDialog.value = false
    await Promise.all([load(), loadCredits(), loadAuditLogs()])
  } catch (err: any) {
    message.error(err.message || '积分调整失败')
  } finally {
    creditAdjusting.value = false
  }
}

async function loadProjects() {
  projectsLoading.value = true
  try {
    const response = await $fetch<any>(`/api/admin/users/${userId.value}/projects`, {
      query: {
        page: projectsPage.value,
        pageSize: projectsPageSize.value
      }
    })
    projects.value = response.data.projects
    projectsTotal.value = Number(response.data.pagination.total)
  } catch (err: any) {
    message.error(err.message || '加载项目失败')
  } finally {
    projectsLoading.value = false
  }
}

async function loadPreferences() {
  preferencesLoading.value = true
  try {
    const response = await $fetch<any>(`/api/admin/users/${userId.value}/model-preferences`, {
      query: {
        page: preferencesPage.value,
        pageSize: preferencesPageSize.value
      }
    })
    preferences.value = response.data.preferences
    preferencesTotal.value = Number(response.data.pagination.total)
  } catch (err: any) {
    message.error(err.message || '加载模型偏好失败')
  } finally {
    preferencesLoading.value = false
  }
}

async function loadDevices() {
  devicesLoading.value = true
  try {
    const response = await $fetch<any>(`/api/admin/users/${userId.value}/devices`, {
      query: {
        page: devicesPage.value,
        pageSize: devicesPageSize.value
      }
    })
    devices.value = response.data.devices
    devicesTotal.value = Number(response.data.pagination.total)
  } catch (err: any) {
    message.error(err.message || '加载设备失败')
  } finally {
    devicesLoading.value = false
  }
}

function handleProjectsPageChange(page: number) {
  projectsPage.value = page
  void loadProjects()
}

function handlePreferencesPageChange(page: number) {
  preferencesPage.value = page
  void loadPreferences()
}

function handleDevicesPageChange(page: number) {
  devicesPage.value = page
  void loadDevices()
}

async function toggleUserStatus() {
  try {
    const newStatus = detail.value.user.status === 'active' ? 'disabled' : 'active'
    await $fetch(`/api/admin/users/${userId.value}/status`, {
      method: 'PATCH',
      body: { status: newStatus }
    })
    message.success(`已${newStatus === 'active' ? '启用' : '禁用'}用户`)
    showStatusConfirm.value = false
    await load()
  } catch (err: any) {
    message.error(err.message || '操作失败')
  }
}

async function updateUserInfo() {
  editLoading.value = true
  try {
    await $fetch(`/api/admin/users/${userId.value}`, {
      method: 'PATCH',
      body: editForm
    })
    message.success('用户信息已更新')
    showEditDialog.value = false
    await load()
  } catch (err: any) {
    message.error(err.message || '更新失败')
  } finally {
    editLoading.value = false
  }
}

async function resetPassword() {
  if (!resetPasswordForm.password || resetPasswordForm.password.length < 6) {
    message.warning('密码长度至少为 6 位')
    return
  }
  resetPasswordLoading.value = true
  try {
    await $fetch(`/api/admin/users/${userId.value}/reset-password`, {
      method: 'POST',
      body: { password: resetPasswordForm.password }
    })
    message.success('密码已重置')
    showResetPasswordDialog.value = false
    resetPasswordForm.password = ''
  } catch (err: any) {
    message.error(err.message || '重置失败')
  } finally {
    resetPasswordLoading.value = false
  }
}

async function loadLogs() {
  logsLoading.value = true
  try {
    const response = await $fetch<any>(`/api/admin/users/${userId.value}/logs`, {
      query: {
        page: logsPage.value,
        pageSize: logsPageSize.value,
        keyword: logsKeyword.value,
        provider: logsProvider.value,
        status: logsStatus.value
      }
    })
    logs.value = response.data.logs
    logsTotal.value = Number(response.data.pagination.total)
  } catch (err: any) {
    message.error(err.message || '加载日志失败')
  } finally {
    logsLoading.value = false
  }
}

function handleLogsPageChange(page: number) {
  logsPage.value = page
  void loadLogs()
  void loadCredits()
}

async function loadAuditLogs() {
  auditLoading.value = true
  try {
    const response = await $fetch<any>(`/api/admin/users/${userId.value}/audit-logs`, {
      query: {
        page: auditPage.value,
        pageSize: auditPageSize.value,
        keyword: auditKeyword.value
      }
    })
    auditLogs.value = response.data.logs
    auditTotal.value = Number(response.data.pagination.total)
  } catch (err: any) {
    message.error(err.message || '加载审计日志失败')
  } finally {
    auditLoading.value = false
  }
}

function handleAuditPageChange(page: number) {
  auditPage.value = page
  void loadAuditLogs()
}

async function deleteDevice(row: any) {
  try {
    await $fetch(`/api/admin/devices/${row.id}`, {
      method: 'DELETE'
    })
    message.success('设备已删除')
    await loadDevices()
  } catch (err: any) {
    message.error(err.message || '删除失败')
  }
}

async function updateDeviceStatus(row: any) {
  await $fetch(`/api/admin/devices/${row.id}/status`, {
    method: 'PATCH',
    body: { status: row.status === 'active' ? 'disabled' : 'active' }
  })
  await loadDevices()
}

async function openProject(projectId: string) {
  const response = await $fetch<any>(`/api/admin/users/${userId.value}/projects/${projectId}`)
  selectedProject.value = response.data.project
  selectedProjectSnapshot.value = response.data.snapshot
  activeProjectStage.value = 'parse'
  activeProjectAssetTab.value = 'characters'
  selectedProjectEpisodeId.value = ''
  projectDrawer.value = true
}

function projectRowProps(row: any) {
  return {
    class: 'users-detail-table-row',
    onClick: () => {
      void openProject(row.id)
    }
  }
}

function toRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, any>
}

function normalizeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return Object.values(value as Record<string, unknown>)
}

function firstPresent(source: unknown, keys: string[]): unknown {
  const record = toRecord(source)
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function firstText(source: unknown, keys: string[]): string {
  const value = firstPresent(source, keys)
  return readableText(value).trim()
}

function readableText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return stripHtml(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map(item => readableText(item))
      .filter(Boolean)
      .join('\n')
  }

  const record = toRecord(value)
  return Object.entries(record)
    .map(([key, item]) => {
      const text = readableText(item)
      return text ? `${fieldLabel(key)}：${text}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    storyIdea: '故事创意',
    rawText: '原始文本',
    novelText: '小说文本',
    description: '描述',
    title: '标题',
    name: '名称',
    summary: '摘要',
    scenes: '场景',
    characters: '角色',
    location: '地点',
    timeOfDay: '时间',
    mood: '氛围',
    weather: '天气'
  }
  return labels[key] || key
}

function pushTextSection(sections: TextSection[], title: string, value: unknown) {
  const content = readableText(value).trim()
  if (!content) return
  if (sections.some(section => section.content === content)) return
  sections.push({ title, content })
}

function displayValue(value: unknown): string {
  const text = readableText(value).replace(/\s+/g, ' ').trim()
  return text || '-'
}

function numberFromSummary(key: string): number {
  const value = Number(selectedProjectSummary.value[key])
  return Number.isFinite(value) ? value : 0
}

function formatProjectDuration(value: unknown): string {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return '-'
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

function projectStatusTagType(status: unknown): TagType {
  const value = String(status || '').toLowerCase()
  if (['active', 'done', 'completed', 'video_ready', 'published'].includes(value)) return 'success'
  if (['generating', 'processing', 'syncing'].includes(value)) return 'warning'
  if (['error', 'failed', 'disabled'].includes(value)) return 'error'
  return 'default'
}

function scriptParseModeLabel(value: string): string {
  const labels: Record<string, string> = {
    short_drama: '短剧',
    standard: '标准',
    novel: '小说',
    idea: '创意'
  }
  return labels[value] || value || '-'
}

function previewableMediaUrl(value: string): string {
  if (!value) return ''
  return /^(https?:)?\/\//.test(value) || value.startsWith('/') ? value : ''
}

function inferAssetKind(value: string, fallback?: string): AssetItem['kind'] {
  const type = String(fallback || '').toLowerCase()
  if (type.includes('video')) return 'video'
  if (type.includes('image') || type.includes('photo')) return 'image'
  const normalized = value.split('?')[0]?.toLowerCase() || ''
  if (/\.(mp4|mov|webm|m4v)$/.test(normalized)) return 'video'
  if (/\.(png|jpe?g|webp|gif|avif|bmp)$/.test(normalized)) return 'image'
  return 'file'
}

function assetKindLabel(kind: AssetItem['kind']): string {
  if (kind === 'image') return '图片'
  if (kind === 'video') return '视频'
  return '文件'
}

function addAsset(items: AssetItem[], input: {
  id: string
  title: string
  description?: string
  url?: unknown
  kind?: string
}) {
  const url = readableText(input.url).trim()
  if (!url) return
  const kind = inferAssetKind(url, input.kind)
  items.push({
    id: input.id,
    title: input.title,
    description: input.description,
    kind,
    kindLabel: assetKindLabel(kind),
    url,
    previewable: Boolean(previewableMediaUrl(url))
  })
}

function collectExplicitAssets(items: AssetItem[]) {
  const explicitAssets = normalizeArray(
    firstPresent(selectedProjectData.value, ['assets', 'materials', 'media'])
      || firstPresent(selectedProjectScript.value, ['assets', 'assetWorkflow'])
  )
  explicitAssets.forEach((asset, index) => {
    const record = toRecord(asset)
    addAsset(items, {
      id: firstText(record, ['id', 'key']) || `asset-${index}`,
      title: firstText(record, ['title', 'name', 'label']) || `素材 ${index + 1}`,
      description: firstText(record, ['description', 'type']),
      url: firstPresent(record, ['url', 'src', 'imageUrl', 'videoUrl', 'objectKey', 'key']),
      kind: firstText(record, ['kind', 'type', 'mediaType'])
    })
  })
}

function collectSceneAssets(items: AssetItem[]) {
  rawProjectScenes.value.forEach((scene, index) => {
    const record = toRecord(scene)
    const title = firstText(record, ['title', 'name']) || `场景 ${index + 1}`
    addAsset(items, {
      id: `scene-${firstText(record, ['id']) || index}-first`,
      title: `${title} 首帧`,
      url: firstPresent(record, ['firstFrame']),
      kind: 'image'
    })
    addAsset(items, {
      id: `scene-${firstText(record, ['id']) || index}-last`,
      title: `${title} 尾帧`,
      url: firstPresent(record, ['lastFrame']),
      kind: 'image'
    })
    addAsset(items, {
      id: `scene-${firstText(record, ['id']) || index}-video`,
      title: `${title} 视频`,
      url: firstPresent(record, ['videoUrl']),
      kind: 'video'
    })
  })
}

function collectCharacterAssets(items: AssetItem[]) {
  rawProjectCharacters.value.forEach((character, index) => {
    const record = toRecord(character)
    const title = firstText(record, ['name', 'title']) || `角色 ${index + 1}`
    addAsset(items, {
      id: `character-${firstText(record, ['id']) || index}-base`,
      title: `${title} 形象`,
      url: firstPresent(record, ['imageUrl', 'baseImage']),
      kind: 'image'
    })
  })
}

function dedupeAssetItems(items: AssetItem[]): AssetItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.url || item.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function snapshotPromptProfiles(): any[] {
  const snapshot = toRecord(promptState.value?.snapshot)
  return normalizeArray(firstPresent(snapshot, ['profiles', 'profileList']))
}

function snapshotPromptTemplates(): any[] {
  const snapshot = toRecord(promptState.value?.snapshot)
  return normalizeArray(firstPresent(snapshot, ['templates', 'templateList']))
}

function normalizePromptContent(value: string): string {
  return stripHtml(value)
}

function promptSourceLabel(source: string): string {
  if (source === 'user_custom') return '用户自定义'
  if (source === 'system_default') return '系统默认'
  return source || '未知来源'
}

function promptSourceTagType(source: string): TagType {
  if (source === 'user_custom') return 'warning'
  if (source === 'system_default') return 'default'
  return 'info'
}

function normalizedEpisodeIndex(record: Record<string, any>, fallbackIndex: number): number {
  const index = Number(firstPresent(record, ['index', 'episodeIndex']))
  return Number.isFinite(index) && index > 0 ? Math.round(index) : fallbackIndex + 1
}

function resolveEpisodeSceneCount(episodeId: string, episodeIndex: number): number {
  return rawProjectScenes.value.filter((scene) => {
    const record = toRecord(scene)
    return firstText(record, ['episodeId']) === episodeId
      || Number(firstPresent(record, ['episodeIndex'])) === episodeIndex
  }).length
}

function resolveEpisodeDoneCount(episodeId: string, episodeIndex: number): number {
  return rawProjectScenes.value.filter((scene) => {
    const record = toRecord(scene)
    const matched = firstText(record, ['episodeId']) === episodeId
      || Number(firstPresent(record, ['episodeIndex'])) === episodeIndex
    return matched && sceneVideoStatus(record) === 'done'
  }).length
}

function resolveEpisodeDuration(episodeId: string, episodeIndex: number): number {
  return rawProjectScenes.value.reduce((sum: number, scene) => {
    const record = toRecord(scene)
    const matched = firstText(record, ['episodeId']) === episodeId
      || Number(firstPresent(record, ['episodeIndex'])) === episodeIndex
    if (!matched) return sum
    const duration = Number(firstPresent(record, ['duration', 'seconds']))
    return Number.isFinite(duration) ? sum + duration : sum
  }, 0)
}

function formatEpisodeAssets(record: Record<string, any>): string {
  const assets = toRecord(record.episodeAssets)
  const characters = normalizeArray(assets.characters).length
  const props = normalizeArray(assets.props).length
  const environments = normalizeArray(assets.environments).length
  const parts = [
    characters ? `${characters} 角色` : '',
    environments ? `${environments} 环境` : '',
    props ? `${props} 道具` : ''
  ].filter(Boolean)
  return parts.length ? `资产 ${parts.join(' / ')}` : ''
}

function countScenesForCharacter(name: string): number {
  if (!name) return 0
  return rawProjectScenes.value.filter((scene) => {
    const characters = normalizeArray(firstPresent(scene, ['characters']))
    return characters.some((item) => firstText(item, ['name']) === name || readableText(item).includes(name))
  }).length
}

function resolveCharacterRoleLabel(role?: string): string {
  if (role === 'protagonist') return '主角'
  if (role === 'antagonist') return '反派'
  if (role === 'supporting') return '配角'
  if (role === 'extra') return '群演'
  return role || '角色'
}

function projectWorkflowPropCards(category: 'prop' | 'other'): ProjectPropCard[] {
  return normalizeArray(projectAssetWorkflow.value.props)
    .map((item, index) => {
      const record = toRecord(item)
      const propCategory = firstText(record, ['category']) === 'other' ? 'other' : 'prop'
      if (propCategory !== category) return null
      const voiceAsset = toRecord(record.voiceAsset)
      const imageUrl = previewableMediaUrl(firstText(record, ['referenceImage', 'imageUrl']))
      const voiceUrl = firstText(voiceAsset, ['audioUrl', 'url'])
      const mediaType = firstText(record, ['mediaType'])
      return {
        id: firstText(record, ['id']) || `${category}-${index}`,
        name: firstText(record, ['name', 'title']) || (category === 'prop' ? `道具 ${index + 1}` : `素材 ${index + 1}`),
        description: firstText(record, ['description']),
        imageUrl,
        voiceUrl,
        mediaLabel: voiceUrl || mediaType === 'voice' ? '声音' : '图片',
        usageCount: propUsageCount(firstText(record, ['name', 'title']), firstText(record, ['id'])),
        readyText: imageUrl || voiceUrl ? '已就绪' : '待补充'
      }
    })
    .filter((item): item is ProjectPropCard => item !== null)
}

function propUsageCount(name: string, id: string): number {
  return rawProjectScenes.value.filter((scene) => {
    const props = normalizeArray(firstPresent(scene, ['props']))
    const description = firstText(scene, ['description'])
    return props.some((item) => firstText(item, ['name']) === name || firstText(item, ['id']) === id)
      || (!!name && description.includes(name))
  }).length
}

function normalizeFinalVideo(value: unknown): { videoUrl: string, duration?: number, size?: number, updatedAt?: string } | null {
  const record = toRecord(value)
  const videoUrl = firstText(record, ['videoUrl', 'videoData', 'url'])
  if (!videoUrl) return null
  const duration = Number(firstPresent(record, ['duration']))
  const size = Number(firstPresent(record, ['size']))
  return {
    videoUrl,
    duration: Number.isFinite(duration) ? duration : undefined,
    size: Number.isFinite(size) ? size : undefined,
    updatedAt: firstText(record, ['updatedAt', 'updated_at'])
  }
}

function sceneReferenceImage(scene: Record<string, any>): string {
  return firstText(scene, ['firstFrame', 'lastFrame', 'referenceImage'])
}

function sceneReferenceStatus(scene: Record<string, any>): string {
  if (sceneReferenceImage(scene)) return 'done'
  const status = firstText(scene, ['referenceStatus', 'status']).toLowerCase()
  if (['done', 'completed', 'ready', 'video_ready'].includes(status)) return 'done'
  if (['generating', 'running', 'processing'].includes(status)) return 'generating'
  if (['error', 'failed'].includes(status)) return 'error'
  return 'pending'
}

function sceneVideoStatus(scene: Record<string, any>): string {
  if (firstText(scene, ['videoUrl'])) return 'done'
  const status = firstText(scene, ['videoStatus', 'status']).toLowerCase()
  if (['done', 'completed', 'ready', 'video_ready'].includes(status)) return 'done'
  if (['generating', 'running', 'processing'].includes(status)) return 'generating'
  if (['error', 'failed'].includes(status)) return 'error'
  return 'pending'
}

function visualStatusLabel(status: string): string {
  if (status === 'done') return '就绪'
  if (status === 'error') return '失败'
  if (status === 'generating') return '生成中'
  return '待生成'
}

function visualStatusTagType(status: string): TagType {
  if (status === 'done') return 'success'
  if (status === 'error') return 'error'
  if (status === 'generating') return 'warning'
  return 'default'
}

function mergeVisualStatus(current: string, next: string): string {
  if (current === 'generating' || next === 'generating') return 'generating'
  if (current === 'done' || next === 'done') return 'done'
  if (current === 'error' || next === 'error') return 'error'
  return 'pending'
}

function resolveSceneEnvironmentAssetId(scene: Record<string, any>): string {
  const setting = toRecord(scene.setting)
  const location = firstText(setting, ['location']) || '未指定地点'
  const timeOfDay = firstText(setting, ['timeOfDay'])
  return `env:${location}||${timeOfDay}`
}

function resolveEnvironmentAssetLabel(assetId: string, setting: Record<string, any>): string {
  const normalized = assetId.replace(/^env:/, '')
  const [rawLocation = '', rawTime = ''] = normalized.split('||')
  const location = firstText(setting, ['location']) || rawLocation || '未指定地点'
  const timeOfDay = firstText(setting, ['timeOfDay']) || rawTime
  return timeOfDay ? `${location} / ${timeOfDay}` : location
}

function resolveEnvironmentState(assetId: string, scene: Record<string, any>): Record<string, any> {
  const aliases = [
    assetId,
    resolveSceneEnvironmentAssetId(scene)
  ]
  for (const alias of aliases) {
    const state = toRecord(projectEnvironmentPanoramaStates.value[alias])
    if (Object.keys(state).length > 0) return state
  }
  return {}
}

function projectAssetStageStatus(): ProjectStageStatus {
  if (projectCharacterCards.value.some(character => character.statusText === '生成中')) return 'running'
  if (projectEnvironmentCards.value.some(card => card.statusText === '生成中')) return 'running'
  if (
    projectCharacterCards.value.length
    || projectEnvironmentCards.value.length
    || projectPropCards.value.length
    || projectOtherAssetCards.value.length
  ) {
    return projectCharacterMissingCount.value === 0 ? 'done' : 'pending'
  }
  return 'pending'
}

function projectVideoStageStatus(): ProjectStageStatus {
  if (rawProjectScenes.value.some(scene => sceneVideoStatus(toRecord(scene)) === 'generating')) return 'running'
  if (rawProjectScenes.value.length > 0 && projectVideoDoneCount.value === rawProjectScenes.value.length) return 'done'
  if (projectVideoDoneCount.value > 0) return 'running'
  return 'pending'
}

function formatSettingText(scene: Record<string, any>): string {
  const setting = toRecord(scene.setting)
  const parts = [
    firstText(setting, ['location']),
    firstText(setting, ['timeOfDay']),
    firstText(setting, ['mood'])
  ].filter(Boolean)
  return parts.length ? `环境 ${parts.join(' / ')}` : ''
}

function formatSceneCharacters(scene: Record<string, any>): string {
  const characters = normalizeArray(firstPresent(scene, ['characters']))
    .map(item => firstText(item, ['name']) || readableText(item))
    .filter(Boolean)
  if (characters.length === 0) return ''
  return `角色 ${characters.slice(0, 3).join('、')}${characters.length > 3 ? ' 等' : ''}`
}

function transitionLabel(value: string): string {
  if (value === 'fade') return '淡入淡出'
  if (value === 'dissolve') return '叠化'
  if (value === 'wipe') return '擦除'
  if (value === 'none') return '无'
  return value || '-'
}

function formatFileSize(value: unknown): string {
  const size = Number(value)
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

onMounted(() => {
  void load()
  void loadProjects()
  void loadPreferences()
  void loadDevices()
  void loadLogs()
  void loadAuditLogs()
})
</script>

<style scoped>
.user-detail-header {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.user-avatar-section {
  flex: 0 0 auto;
}

.user-info-section {
  flex: 1;
  min-width: 0;
}

.user-title-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.user-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #101828;
}

.user-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  color: #475467;
  font-size: 13px;
}

.user-meta-grid strong {
  color: #344054;
  font-weight: 600;
}

.user-actions-section {
  flex: 0 0 auto;
}

.detail-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.detail-item,
.metric-item,
.visual-section {
  border: 1px solid #edf0f5;
  border-radius: 6px;
  background: #fff;
}

.detail-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
}

.detail-label,
.preview-subtitle,
.preview-meta,
.section-note,
.asset-url,
.empty-inline {
  color: #667085;
  font-size: 12px;
}

.detail-value {
  min-width: 0;
  overflow: hidden;
  color: #101828;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
}

.metric-item strong {
  color: #101828;
  font-size: 20px;
  line-height: 1.2;
}

.metric-item span {
  color: #667085;
  font-size: 12px;
}

.visual-section {
  padding: 14px;
}

.section-title {
  margin-bottom: 12px;
  color: #101828;
  font-weight: 600;
}

.subsection-title {
  margin-bottom: 6px;
  color: #344054;
  font-size: 13px;
  font-weight: 600;
}

.text-section-list,
.preview-list,
.template-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.text-block,
.prompt-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.text-block {
  color: #344054;
  line-height: 1.7;
}

.preview-item,
.profile-item,
.template-item,
.asset-item {
  border: 1px solid #edf0f5;
  border-radius: 6px;
  background: #f9fafb;
}

.preview-item {
  padding: 12px;
}

.preview-item--media {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.preview-body,
.asset-body {
  min-width: 0;
}

.preview-avatar {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  border-radius: 6px;
  object-fit: cover;
}

.preview-title {
  color: #101828;
  font-weight: 600;
}

.preview-description {
  margin: 6px 0 0;
  color: #344054;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.preview-meta span {
  border-radius: 4px;
  background: #eef2f6;
  padding: 2px 6px;
}

.section-note {
  margin-top: 10px;
}

.asset-grid,
.profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.asset-item {
  overflow: hidden;
}

.asset-preview {
  display: flex;
  height: 132px;
  align-items: center;
  justify-content: center;
  background: #eef2f6;
  color: #667085;
  font-size: 12px;
}

.asset-preview img,
.asset-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-body,
.profile-item,
.template-item {
  padding: 12px;
}

.asset-url {
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-head,
.template-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.template-tags {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.prompt-content {
  max-height: 260px;
  margin-top: 10px;
  overflow: auto;
  border-radius: 6px;
  background: #fff;
  padding: 10px;
  color: #344054;
  line-height: 1.6;
}

.workbench-readonly {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.workbench-header {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  justify-content: space-between;
}

.workbench-title {
  min-width: 220px;
  max-width: 360px;
}

.workbench-title h3 {
  margin: 0;
  overflow: hidden;
  color: #101828;
  font-size: 18px;
  font-weight: 650;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workbench-meta,
.readonly-status-row,
.client-card-meta,
.episode-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  color: #667085;
  font-size: 12px;
}

.workbench-meta span + span::before {
  content: "";
  display: inline-block;
  width: 4px;
  height: 4px;
  margin: 0 8px 2px 0;
  border-radius: 999px;
  background: #98a2b3;
}

.workbench-stage-switcher {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
}

.stage-connector {
  height: 1px;
  min-width: 24px;
  flex: 1;
  background: #e4e7ec;
}

.stage-connector--done {
  background: rgba(18, 183, 106, 0.45);
}

.stage-pill,
.asset-tab {
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.stage-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-radius: 999px;
  padding: 7px 12px;
  color: #667085;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.stage-index {
  display: inline-grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 999px;
  background: rgba(102, 112, 133, 0.12);
  font-size: 12px;
}

.stage-pill--done {
  color: #087443;
  background: rgba(18, 183, 106, 0.1);
}

.stage-pill--done .stage-index {
  color: #079455;
  background: rgba(18, 183, 106, 0.18);
}

.stage-pill--running {
  color: #175cd3;
  background: rgba(47, 109, 246, 0.1);
}

.stage-pill--pending {
  background: #f2f4f7;
}

.stage-pill--active {
  color: #fff;
  background: #18a058;
  box-shadow: 0 6px 14px rgba(24, 160, 88, 0.18);
}

.stage-pill--active .stage-index {
  color: #fff;
  background: rgba(255, 255, 255, 0.22);
}

.workbench-panel {
  min-height: 520px;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  background: #fff;
  padding: 14px;
}

.readonly-stage {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.script-reader {
  position: relative;
  min-height: 280px;
  overflow: hidden;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  background: #f9fafb;
}

.script-reader__content {
  max-height: 360px;
  margin: 0;
  overflow: auto;
  padding: 14px;
  color: #344054;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.script-reader__badge {
  position: absolute;
  right: 12px;
  bottom: 10px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.88);
  padding: 3px 8px;
  color: #667085;
  font-size: 12px;
}

.empty-block {
  display: grid;
  min-height: 220px;
  place-items: center;
  color: #98a2b3;
  font-size: 13px;
}

.readonly-status-row {
  align-items: center;
}

.readonly-status-row--split {
  justify-content: space-between;
}

.readonly-status-row--split > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 999px;
  background: #98a2b3;
}

.dot--green {
  background: #12b76a;
}

.dot--blue {
  background: #2f6df6;
}

.dot--amber {
  background: #f79009;
}

.dot--violet {
  background: #7a5af8;
}

.dot--red {
  background: #f04438;
}

.readonly-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.episode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.episode-card,
.client-character-card,
.client-environment-card,
.client-prop-card,
.final-options-card,
.final-timeline-card,
.final-video-card,
.scene-video-card,
.episode-directory {
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  background: #fff;
}

.episode-card {
  padding: 12px;
}

.episode-card__head,
.client-card-title,
.scene-video-card__head,
.episode-directory__head,
.profile-head,
.template-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
}

.episode-card__head strong,
.client-card-title strong,
.scene-video-card__head strong,
.episode-directory__head strong {
  min-width: 0;
  overflow: hidden;
  color: #101828;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.episode-card__head span,
.client-card-title span,
.episode-directory__head span {
  flex: 0 0 auto;
  color: #667085;
  font-size: 12px;
}

.episode-card p,
.client-card-main p,
.scene-video-card p,
.episode-directory__detail p {
  margin: 6px 0 0;
  color: #475467;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.episode-beats {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 5px 8px;
  margin: 10px 0 0;
  color: #475467;
  font-size: 12px;
}

.episode-beats dt {
  color: #667085;
}

.episode-beats dd {
  margin: 0;
}

.asset-tabbar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid #e4e7ec;
}

.asset-tab {
  position: relative;
  padding: 9px 14px;
  color: #667085;
  font-size: 13px;
  font-weight: 600;
}

.asset-tab span {
  margin-left: 4px;
  color: #98a2b3;
  font-size: 12px;
}

.asset-tab--active {
  color: #101828;
}

.asset-tab--active::after {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  border-radius: 999px;
  background: #18a058;
  content: "";
}

.client-card-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.client-card-grid--two {
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}

.client-character-card,
.client-environment-card,
.client-prop-card {
  overflow: hidden;
  background: #fff;
}

.client-character-card__body {
  display: flex;
  gap: 12px;
  padding: 12px;
}

.client-avatar {
  position: relative;
  display: grid;
  width: 80px;
  height: 80px;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: #f2f4f7;
  color: #98a2b3;
  font-size: 12px;
}

.client-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.client-avatar i {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 10px;
  height: 10px;
  border: 2px solid #fff;
  border-radius: 999px;
}

.status-dot--done {
  background: #12b76a;
}

.status-dot--running {
  background: #2f6df6;
}

.status-dot--pending {
  background: #f79009;
}

.client-card-main {
  min-width: 0;
  flex: 1;
}

.client-card-main--padded {
  padding: 10px 12px;
}

.client-card-title {
  align-items: center;
  justify-content: flex-start;
}

.client-card-title span {
  color: #667085;
  font-size: 12px;
}

.mini-badge {
  border-radius: 999px;
  background: rgba(24, 160, 88, 0.1);
  padding: 1px 6px;
  color: #087443 !important;
}

.client-card-meta {
  margin-top: 8px;
}

.client-audio-row {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #e4e7ec;
  padding: 10px 12px;
}

.client-audio-row div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.client-audio-row strong {
  color: #101828;
  font-size: 12px;
}

.client-audio-row span {
  color: #667085;
  font-size: 12px;
}

.client-character-card audio {
  width: calc(100% - 24px);
  margin: 0 12px 12px;
}

.environment-preview-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: #e4e7ec;
}

.environment-preview,
.client-prop-preview,
.scene-frame {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #f2f4f7;
  color: #98a2b3;
  font-size: 12px;
}

.environment-preview {
  aspect-ratio: 16 / 9;
}

.environment-preview img,
.client-prop-preview img,
.scene-frame img,
.scene-media-row video,
.final-video-card video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.environment-preview b {
  position: absolute;
  top: 8px;
  left: 8px;
  border: 1px solid rgba(208, 213, 221, 0.9);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.92);
  padding: 1px 5px;
  color: #667085;
  font-size: 12px;
  font-weight: 500;
}

.environment-status {
  position: absolute;
  top: 8px;
  right: 8px;
}

.client-prop-preview {
  height: 160px;
}

.client-prop-preview audio {
  width: calc(100% - 24px);
}

.video-stage-grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
}

.episode-directory {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: #fcfcfd;
}

.episode-directory__head {
  border-bottom: 1px solid #e4e7ec;
  padding: 10px 12px;
}

.episode-directory__item {
  display: block;
  width: calc(100% - 16px);
  margin: 8px 8px 0;
  border: 1px solid #e4e7ec;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  padding: 8px;
  text-align: left;
}

.episode-directory__item strong,
.episode-directory__item span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.episode-directory__item strong {
  color: #101828;
  font-size: 12px;
}

.episode-directory__item span {
  margin-top: 2px;
  color: #667085;
  font-size: 12px;
}

.episode-directory__item--active {
  border-color: #98a2b3;
  background: #f2f4f7;
}

.episode-directory__detail {
  margin-top: auto;
  border-top: 1px solid #e4e7ec;
  padding: 10px 12px;
  color: #667085;
  font-size: 12px;
}

.episode-directory__detail span {
  display: block;
  margin-bottom: 4px;
}

.scene-list {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.scene-list__head {
  border: 1px solid #e4e7ec;
  border-radius: 6px;
  background: #f9fafb;
  padding: 9px 12px;
  color: #667085;
  font-size: 12px;
}

.scene-video-card {
  padding: 12px;
}

.scene-video-card__head span {
  display: block;
  color: #667085;
  font-size: 12px;
}

.scene-badges {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.scene-media-row {
  display: grid;
  grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
  gap: 10px;
  margin-top: 10px;
}

.scene-frame,
.scene-media-row video {
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  background: #f2f4f7;
}

.scene-narration {
  border-left: 2px solid #d0d5dd;
  padding-left: 8px;
}

.final-stage-grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 12px;
}

.final-options-card,
.final-timeline-card,
.final-video-card {
  padding: 12px;
}

.final-options-card dl {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 8px 10px;
  margin: 0;
  color: #475467;
  font-size: 12px;
}

.final-options-card dt {
  color: #667085;
}

.final-options-card dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.final-scene-list {
  display: flex;
  max-height: 260px;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.final-scene-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 72px auto;
  gap: 8px;
  align-items: center;
  border: 1px solid #e4e7ec;
  border-radius: 6px;
  background: #f9fafb;
  padding: 7px 8px;
  color: #667085;
  font-size: 12px;
}

.final-scene-item strong {
  overflow: hidden;
  color: #101828;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.final-scene-item em {
  color: #667085;
  font-style: normal;
}

.final-video-card video {
  max-height: 420px;
  border-radius: 8px;
  background: #101828;
}

@media (max-width: 900px) {
  .workbench-header,
  .video-stage-grid,
  .final-stage-grid {
    grid-template-columns: 1fr;
  }

  .workbench-header {
    flex-direction: column;
  }

  .workbench-stage-switcher {
    width: 100%;
    overflow-x: auto;
  }

  .stage-connector {
    flex: 0 0 20px;
  }

  .scene-media-row {
    grid-template-columns: 1fr;
  }
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

:deep(.users-detail-table-row) {
  cursor: pointer;
}

:deep(.users-detail-table-row:hover td) {
  background: rgba(24, 160, 88, 0.06);
}
</style>
