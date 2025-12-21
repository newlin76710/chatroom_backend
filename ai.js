import express from "express";
import fetch from "node-fetch";

export const aiProfiles = {
  "林怡君": { style: "外向", desc: "很健談，喜歡分享生活。", level: 5, job: "社群行銷", gender: "女" },
  "張雅婷": { style: "害羞", desc: "說話溫柔，句子偏短。", level: 8, job: "學生", gender: "女" },
  "黃彥廷": { style: "穩重", desc: "語氣沈穩，回覆較中性。", level: 15, job: "律師", gender: "男" }
  // 可自行擴充其他 AI
};
export const aiNames = Object.keys(aiProfiles);

export const aiRouter = express.Router();

aiRouter.post("/reply", async (req, res) => {
  const { message, aiName } = req.body;
  if (!message || !aiName) return res.status(400).json({ error: "缺少參數" });
  const reply = await callAI(message, aiName);
  res.json({ reply });
});

export async function callAI(userMessage, aiName) {
  const p = aiProfiles[aiName] || { style: "中性", desc: "", level: 99, job: "未知職業" };
  const jobText = p.job ? `她/他的職業是 ${p.job}，` : "";

  try {
    const response = await fetch('http://220.135.33.190:11434/v1/completions', {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3",
        prompt: `
你是一名叫「${aiName}」的台灣人，個性是：${p.desc}（${p.style}）。
${jobText}請用繁體中文回覆，省略廢話跟自我介紹，控制在10~30字內：
「${userMessage}」`,
        temperature: 0.8
      })
    });
    const data = await response.json();
    return (data.completion || data.choices?.[0]?.text || "嗯～").trim();
  } catch (e) {
    console.error("callAI error:", e);
    return "我剛剛又 Lag 了一下哈哈。";
  }
}
