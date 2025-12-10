import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";


const GEMINI_API_KEY = 'AIzaSyCFvBGHpMAh8eqncjZSCtJL13DXLfM-nmk'

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// document: https://ai.google.dev/gemini-api/docs

// async function textGen() {
//   const response = await ai.models.generateContent({
//     model: "gemini-3-pro-preview",
//     contents: "How does AI work?",
//   });
//   console.log(response.text);
// }

// await textGen();


// async function imageGen() {
//   const response = await ai.models.generateContent({
//     model: "gemini-3-pro-image-preview",
//     contents: "Generate a visualization of the current weather in Tokyo.",
//     config: {
//       tools: [{ googleSearch: {} }],
//       imageConfig: {
//         aspectRatio: "16:9",
//         imageSize: "4K"
//       }
//     }
//   }) as any;

//   for (const part of response.candidates[0].content.parts) {
//     if (part.inlineData) {
//       const imageData = part.inlineData.data as any;
//       const buffer = Buffer.from(imageData, "base64");
//       fs.writeFileSync("weather_tokyo.png", buffer);
//     }
//   }
// }

// await imageGen();


// async function videoGen() {
//   const prompt = `A close up of two people staring at a cryptic drawing on a wall, torchlight flickering.
// A man murmurs, 'This must be it. That's the secret code.' The woman looks at him and whispering excitedly, 'What did you find?'`;

//   let operation = await ai.models.generateVideos({
//     model: "veo-3.1-generate-preview",
//     prompt: prompt,
//   }) as any;

//   // Poll the operation status until the video is ready.
//   while (!operation.done) {
//     console.log("Waiting for video generation to complete...")
//     await new Promise((resolve) => setTimeout(resolve, 10000));
//     operation = await ai.operations.getVideosOperation({
//       operation: operation,
//     });
//   }

//   // Download the generated video.
//   ai.files.download({
//     file: operation.response.generatedVideos[0].video,
//     downloadPath: "dialogue_example.mp4",
//   });
//   console.log(`Generated video saved to dialogue_example.mp4`);
// }

// await videoGen();

async function textGen() {
    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: `请解析以下小说文本，提取不超过 10 个场景：\n\n---\n清晨的阳光透过落地窗洒进书房，李明坐在书桌前，手指轻轻敲 
击着键盘。\n\n"又是新的一天。"他自言自语道，嘴角微微上扬。\n\n门突然被推开，一位长发飘飘的女子走了进来。她穿着淡
蓝色的连衣裙，眼神中带着一丝担忧。\n\n"李明，你又熬夜了吗？"女子皱着眉头问道。\n\n李明转过身，看着眼前的女子，温
柔地说："小雨，别担心，我只是在写一个很重要的程序。"\n\n小雨走到他身边，轻轻拍了拍他的肩膀："照顾好自己才是最重 
要的。"\n---\n\n请严格按照系统提示中的 JSON 格式输出解析结果。确保：\n1. 每个场景的 id 格式为 scene_001, scene_002 等\n2. 所有情绪值都是有效的枚举值\n3. 时间段 (timeOfDay) 是有效的枚举值\n4. 角色角色 (role) 是有效的枚举值\n5. 场景时长在 4-8 秒之间\n6. totalDuration 等于所有场景时长之和`,
        config: {
            systemInstruction: `你是一个专业的剧本分析师和编剧助手。你的任务是将小说文本解析为结构化的场景数据，用于生成AI漫剧视频。\n\n##  
输出要求\n\n你必须输出有效的 JSON 格式，包含以下结构：\n\n{\n  "title": "剧本标题（从文本推断）",\n  "scenes": [\n    {\n      "id": "scene_001",\n      "title": "场景标题",\n      "description": "场景的视觉描述，用于生成首 
尾帧图片",\n      "setting": {\n        "location": "具体地点",\n        "timeOfDay": "dawn|morning|noon|afternoon|evening|night",\n        "mood": "氛围描述",\n        "weather": "天气（可选）"\n      },\n      "characters": [\n        {\n          "name": "角色名",\n          "appearance": "外观描述",\n          "action": "动作描述",\n          "emotion": "neutral|happy|sad|angry|surprised|confused|excited|scared"\n        }\n      ],\n      
"dialogues": [\n        {\n          "character": "角色名",\n          "text": "对话内容",\n          "emotion": "情绪",\n          "isInnerThought": false\n        }\n      ],\n      "duration": 8,\n      "narration": "旁白
（可选）"\n    }\n  ],\n  "characters": [\n    {\n      "name": "角色名",\n      "description": "角色描述",\n   
   "role": "protagonist|antagonist|supporting"\n    }\n  ],\n  "totalDuration": 24\n}\n\n## 场景拆分原则\n\n1. **视觉变化**: 当场景地点、时间或主要角色发生变化时，应拆分为新场景\n2. **时长控制**: 每个场景 4-8 秒，根据内容复 
杂度调整\n3. **画面可描述**: 场景描述应具体、视觉化，便于 AI 图片生成\n4. **情节完整**: 每个场景应有完整的小情节
或情感表达\n\n## 角色情绪识别\n\n- neutral: 平静、正常\n- happy: 高兴、满足、微笑\n- sad: 悲伤、难过、沮丧\n- angry: 愤怒、生气、不满\n- surprised: 惊讶、震惊\n- confused: 困惑、疑惑\n- excited: 兴奋、激动\n- scared: 害怕、 
恐惧\n\n## 内心独白处理\n\n当文本包含角色内心想法时（通常用引号或特定描述表示），将 isInnerThought 设为 true。`,
            temperature: 0.2, // JSON 生成使用较低温度
            responseMimeType: 'application/json'
        }
    });
    console.log(response.text);
}

await textGen();