import OpenAI from "openai";

// 建议将 API Key 放在环境变量中
const OPENROUTER_API_KEY =
  "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";

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  // 选填：在 OpenRouter 排行榜上显示的你的应用名称和 URL
  defaultHeaders: {
    "HTTP-Referer": "https://your-site-url.com", // 你的项目域名
    "X-Title": "My Awesome App", // 你的项目名称
  },
});

async function main() {
  try {
    const completion = await openai.chat.completions.create({
      // 可以在 OpenRouter 官网查看具体的模型 ID
      // 例如: "google/gemini-2.0-flash-001" 或 "anthropic/claude-3.5-sonnet"
      model: "qwen/qwen3.6-plus:free",
      messages: [
        {
          role: "user",
          content: "用 TypeScript 写一个快速排序算法。",
        },
      ],
      // 这里的参数和 OpenAI 接口一致
      temperature: 0.7,
    });

    console.log("AI 回复:", completion.choices[0].message.content);
  } catch (error) {
    console.error("请求失败:", error);
  }
}

main();
