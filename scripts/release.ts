#!/usr/bin/env bun
/**
 * 自动发版脚本
 *
 * 功能：
 * 1. 自动将版本号 patch +1（如 1.0.23 → 1.0.24）
 * 2. 更新 package.json 的版本号
 * 3. 自动 git commit 并创建对应的 tag
 * 4. 推送到 GitHub 触发 Actions 构建
 * 5. 如果配置了 GITHUB_TOKEN，临时将私有仓库设为公开，构建完成后设回私有
 *
 * 用法：
 *   bun run release          # patch 版本 +1
 *   bun run release minor    # minor 版本 +1
 *   bun run release major    # major 版本 +1
 */

import { $ } from "bun";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

type ReleaseType = "patch" | "minor" | "major";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const POLL_INTERVAL = 10000; // 10 秒轮询一次
const MAX_WAIT_TIME = 30 * 60 * 1000; // 最长等待 30 分钟

interface PackageJson {
  version: string;
  [key: string]: unknown;
}

interface GitHubRepo {
  owner: string;
  repo: string;
}

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
}

// 获取仓库信息
async function getRepoInfo(): Promise<GitHubRepo | null> {
  try {
    const result = await $`git remote get-url origin`.text();
    const url = result.trim();

    // 支持 SSH 和 HTTPS 格式
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo.git
    const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    const httpsMatch = url.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);

    const match = sshMatch || httpsMatch;
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // 忽略错误
  }
  return null;
}

// GitHub API 请求
async function githubApi(
  endpoint: string,
  options: { method?: string; body?: unknown } = {}
): Promise<Response> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return response;
}

// 检查仓库是否为私有
async function isRepoPrivate(repo: GitHubRepo): Promise<boolean> {
  const response = await githubApi(`/repos/${repo.owner}/${repo.repo}`);
  if (!response.ok) {
    throw new Error(`Failed to get repo info: ${response.statusText}`);
  }
  const data = await response.json();
  return data.private === true;
}

// 设置仓库可见性
async function setRepoVisibility(
  repo: GitHubRepo,
  isPrivate: boolean
): Promise<void> {
  const visibility = isPrivate ? "private" : "public";
  console.log(`Setting repository to ${visibility}...`);

  const response = await githubApi(`/repos/${repo.owner}/${repo.repo}`, {
    method: "PATCH",
    body: { private: isPrivate },
  });

  if (!response.ok) {
    throw new Error(`Failed to set repo visibility: ${response.statusText}`);
  }
  console.log(`Repository is now ${visibility}`);
}

// 等待 workflow 完成
async function waitForWorkflow(
  repo: GitHubRepo,
  commitSha: string
): Promise<boolean> {
  console.log("Waiting for GitHub Actions workflow to complete...");

  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

    const response = await githubApi(
      `/repos/${repo.owner}/${repo.repo}/actions/runs?head_sha=${commitSha}`
    );

    if (!response.ok) {
      console.log("Failed to fetch workflow status, retrying...");
      continue;
    }

    const data = await response.json();
    const runs: WorkflowRun[] = data.workflow_runs || [];

    if (runs.length === 0) {
      console.log("No workflow runs found yet, waiting...");
      continue;
    }

    const run = runs[0];
    console.log(`Workflow status: ${run.status}, conclusion: ${run.conclusion}`);

    if (run.status === "completed") {
      return run.conclusion === "success";
    }
  }

  console.log("Timeout waiting for workflow");
  return false;
}

// 递增版本号
function bumpVersion(version: string, type: ReleaseType): string {
  const parts = version.split(".").map(Number);

  switch (type) {
    case "major":
      parts[0]++;
      parts[1] = 0;
      parts[2] = 0;
      break;
    case "minor":
      parts[1]++;
      parts[2] = 0;
      break;
    case "patch":
    default:
      parts[2]++;
      break;
  }

  return parts.join(".");
}

// 主函数
async function main() {
  const releaseType = (process.argv[2] as ReleaseType) || "patch";

  if (!["patch", "minor", "major"].includes(releaseType)) {
    console.error("Usage: bun run release [patch|minor|major]");
    process.exit(1);
  }

  // 检查是否有未提交的更改
  const status = await $`git status --porcelain`.text();
  if (status.trim()) {
    console.error("Error: Working directory is not clean. Please commit or stash changes first.");
    process.exit(1);
  }

  // 读取 package.json
  const pkgPath = join(process.cwd(), "package.json");
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const oldVersion = pkg.version;
  const newVersion = bumpVersion(oldVersion, releaseType);

  console.log(`Bumping version: ${oldVersion} → ${newVersion}`);

  // 更新 package.json
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("Updated package.json");

  // Git commit
  await $`git add package.json`;
  await $`git commit -m ${"chore(release): v" + newVersion}`;
  console.log("Created commit");

  // 创建 tag
  const tagName = `v${newVersion}`;
  await $`git tag ${tagName}`;
  console.log(`Created tag: ${tagName}`);

  // 获取仓库信息
  const repo = await getRepoInfo();
  let wasPrivate = false;

  // 如果有 GITHUB_TOKEN 且是私有仓库，临时设为公开
  if (GITHUB_TOKEN && repo) {
    try {
      wasPrivate = await isRepoPrivate(repo);
      if (wasPrivate) {
        console.log("Repository is private, temporarily setting to public for free Actions...");
        await setRepoVisibility(repo, false);
      }
    } catch (error) {
      console.log("Could not check/change repo visibility:", error);
    }
  }

  // 推送代码和 tag
  console.log("Pushing to remote...");
  await $`git push`;
  await $`git push --tags`;
  console.log("Pushed successfully");

  // 获取当前 commit SHA
  const commitSha = (await $`git rev-parse HEAD`.text()).trim();

  // 如果需要恢复私有状态，等待 workflow 完成
  if (GITHUB_TOKEN && repo && wasPrivate) {
    try {
      const success = await waitForWorkflow(repo, commitSha);
      if (success) {
        console.log("Workflow completed successfully!");
      } else {
        console.log("Workflow failed or timed out");
      }

      // 恢复私有状态
      await setRepoVisibility(repo, true);
    } catch (error) {
      console.error("Error during workflow monitoring:", error);
      // 确保恢复私有状态
      try {
        await setRepoVisibility(repo, true);
      } catch {
        console.error("CRITICAL: Failed to restore private visibility!");
      }
    }
  }

  console.log(`\nRelease v${newVersion} completed!`);
}

main().catch((error) => {
  console.error("Release failed:", error);
  process.exit(1);
});
