import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY_1;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
  
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Say hi' }] }]
  };
  
  try {
    const res = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
    console.log('SUCCESS:', res.data);
  } catch(e: any) {
    console.log('ERROR STATUS:', e.response?.status);
    console.log('ERROR DATA:', e.response?.data);
  }
}
testGemini();
