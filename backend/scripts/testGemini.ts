import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testGemini(model: string) {
  const apiKey = process.env.GEMINI_API_KEY_1;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Say hi' }] }]
  };
  
  try {
    const res = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
    console.log(`SUCCESS for ${model}:`, res.data.candidates[0].content.parts[0].text.trim());
  } catch(e: any) {
    console.log(`ERROR STATUS for ${model}:`, e.response?.status);
    console.log(`ERROR DATA for ${model}:`, JSON.stringify(e.response?.data, null, 2));
  }
}
async function run() {
  await testGemini('gemini-1.5-flash');
  await testGemini('gemini-2.5-flash');
}
run();
