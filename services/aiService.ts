
import { GoogleGenAI, Modality } from "@google/genai";
import { DetectionResult, InferenceMode, SystemConfig } from "../types";

// 彻底剥离英文字母，防止 TTS 引擎进入拼读模式
const aggressiveSanitize = (text: string): string => {
  if (!text) return "";
  const noLetters = text.replace(/[a-zA-Z]/g, " ");
  const noSymbols = noLetters.replace(/[{}()\[\]"'`<>|_\\\/#@$%^&*+\-=~]/g, " ");
  // 仅保留中文、数字及基本标点
  const final = noSymbols.match(/[\u4e00-\u9fa5|0-9|，。！？]/g);
  return final ? final.join("").replace(/\s+/g, "").trim() : "";
};

let currentAudioSource: AudioBufferSourceNode | null = null;
let currentAudioContext: AudioContext | null = null;

const stopSpeaking = () => {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentAudioSource) {
    try { currentAudioSource.stop(); } catch(e) {}
    currentAudioSource = null;
  }
};

const getAudioContext = () => {
  if (!currentAudioContext) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    currentAudioContext = new AudioCtx({ sampleRate: 24000 });
  }
  return currentAudioContext;
};

const decode = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const decodeAudioData = async (data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
};

export const dispatchSpeak = async (text: string, config: SystemConfig) => {
  const cleanText = aggressiveSanitize(text);
  if (!cleanText) return;

  stopSpeaking();
  console.log(`[TTS Output] "${cleanText}"`);

  try {
    if (config.voiceType === 'ai') {
      await speakWithGemini(cleanText, config);
    } else {
      speakLocally(cleanText, config);
    }
  } catch (err) {
    speakLocally(cleanText, config);
  }
};

const speakWithGemini = async (text: string, config: SystemConfig) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `请播报：${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { 
        voiceConfig: { 
          prebuiltVoiceConfig: { voiceName: config.aiVoiceName || 'Kore' } 
        } 
      },
    },
  });
  
  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (base64Audio) {
    const ctx = getAudioContext();
    const audioBuffer = await decodeAudioData(decode(base64Audio), ctx);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    currentAudioSource = source;
    source.start(0);
  }
};

const speakLocally = (text: string, config: SystemConfig) => {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = config.ttsRate || 1.0;
  const voices = window.speechSynthesis.getVoices();
  const chinese = voices.find(v => v.name.includes('Xiaoxiao') || v.name.includes('Google 普通话')) || voices.find(v => v.lang.includes('zh'));
  if (chinese) utterance.voice = chinese;
  window.speechSynthesis.speak(utterance);
};

export const analyzeScene = async (base64Image: string, config: SystemConfig): Promise<DetectionResult> => {
  const VISION_PROMPT = `Analyze safety. Return ONLY JSON: {"isFallDetected":boolean, "confidence":number, "reasoning":"中文描述", "posture":"standing"|"sitting"|"lying"|"none"}`;
  
  if (config.mode === InferenceMode.LOCAL) {
    const response = await fetch(`${config.localEndpoint}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ model: config.localModel, prompt: VISION_PROMPT, stream: false, images: [base64Image], format: "json" }),
    });
    const data = await response.json();
    return JSON.parse(data.response);
  }

  if (config.mode === InferenceMode.CUSTOM) {
    try {
      const response = await fetch(`${config.customBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.customApiKey}`
        },
        body: JSON.stringify({
          model: config.customModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: VISION_PROMPT },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
              ]
            }
          ],
          response_format: { type: "json_object" }
        })
      });
      const data = await response.json();
      const content = data.choices[0].message.content;
      // 处理国产模型可能带有的 Markdown 代码块标签
      const jsonString = content.replace(/```json|```/g, "").trim();
      return JSON.parse(jsonString);
    } catch (e) {
      console.error("Custom AI Analysis Error:", e);
      throw e;
    }
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: base64Image } }, { text: VISION_PROMPT }] },
    config: { responseMimeType: "application/json", temperature: 0.1 }
  });
  return JSON.parse(response.text || "{}");
};

export { stopSpeaking };
