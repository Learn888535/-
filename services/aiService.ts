
import { GoogleGenAI, Modality } from "@google/genai";
import { DetectionResult, InferenceMode, SystemConfig } from "../types";

const decode = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

const sanitizeForTTS = (text: string): string => {
  if (!text) return "";
  return text.replace(/[{}"[\]]/g, " ").replace(/[:：]/g, " ").replace(/\s+/g, " ").trim();
};

export const stopSpeaking = () => {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
};

export const dispatchSpeak = async (text: string, config: SystemConfig) => {
  const cleanText = sanitizeForTTS(text);
  if (!cleanText) return;

  console.log(`[TTS] 正在尝试通过 ${config.voiceType} 引擎播放: ${cleanText}`);

  try {
    if (config.voiceType === 'ai') {
      await speakWithGemini(cleanText, config);
    } else if (config.voiceType === 'custom_api') {
      await speakWithCustomApi(cleanText, config);
    } else {
      speakLocally(cleanText, config);
    }
  } catch (err) {
    console.warn("[TTS] 引擎调用失败，回退到本地语音", err);
    speakLocally(cleanText, config);
  }
};

const speakWithGemini = async (text: string, config: SystemConfig) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `请用温柔自然的中文播报警报：${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { 
        voiceConfig: { 
          prebuiltVoiceConfig: { 
            voiceName: config.aiVoiceName || 'Kore' 
          } 
        } 
      },
    },
  });
  
  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (base64Audio) {
    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
    const source = outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputAudioContext.destination);
    source.start();
  } else {
    throw new Error("Gemini TTS 返回数据为空");
  }
};

const speakWithCustomApi = async (text: string, config: SystemConfig) => {
  if (!config.customTtsUrl || !config.customTtsApiKey) {
    throw new Error("自定义 TTS 配置不完整");
  }

  const response = await fetch(config.customTtsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.customTtsApiKey}`
    },
    body: JSON.stringify({
      model: config.customTtsModel,
      input: text,
      voice: "alloy",
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`TTS API 响应错误 (${response.status}): ${errBody}`);
  }

  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  await audio.play();
};

export const speakLocally = (text: string, config?: SystemConfig) => {
  if (!('speechSynthesis' in window)) return;
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  if (config) {
    utterance.lang = config.ttsLanguage || 'zh-CN';
    utterance.rate = config.ttsRate || 0.85;
    if (config.ttsVoiceName) {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.name === config.ttsVoiceName);
      if (voice) utterance.voice = voice;
    }
  }
  window.speechSynthesis.speak(utterance);
};

const VISION_PROMPT = `Analyze this scene for safety. Return valid JSON ONLY.
{"isFallDetected": boolean, "confidence": number, "reasoning": "中文描述", "posture": "standing"|"sitting"|"lying"|"none"}`;

export const analyzeScene = async (base64Image: string, config: SystemConfig): Promise<DetectionResult> => {
  if (config.mode === InferenceMode.LOCAL) return analyzeLocal(base64Image, config);
  if (config.mode === InferenceMode.CUSTOM) return analyzeCustom(base64Image, config);

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: base64Image } }, { text: VISION_PROMPT }] },
      config: { responseMimeType: "application/json", temperature: 0.1 }
    });
    return validateResult(JSON.parse(response.text || "{}"));
  } catch (error) {
    return { isFallDetected: false, confidence: 0, reasoning: "分析引擎连接中...", posture: "unknown" };
  }
};

const analyzeCustom = async (base64Image: string, config: SystemConfig): Promise<DetectionResult> => {
  const response = await fetch(`${config.customBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.customApiKey}` },
    body: JSON.stringify({
      model: config.customModel,
      messages: [{ role: "user", content: [{ type: "text", text: VISION_PROMPT }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }],
      response_format: { type: "json_object" }
    })
  });
  const data = await response.json();
  return validateResult(JSON.parse(data.choices[0].message.content));
};

const analyzeLocal = async (base64Image: string, config: SystemConfig): Promise<DetectionResult> => {
  const response = await fetch(`${config.localEndpoint}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model: config.localModel, prompt: VISION_PROMPT, stream: false, images: [base64Image], format: "json" }),
  });
  const data = await response.json();
  return validateResult(JSON.parse(data.response));
};

const validateResult = (result: any): DetectionResult => {
  return {
    isFallDetected: !!result.isFallDetected,
    confidence: result.confidence || 0,
    reasoning: result.reasoning || "检测中",
    posture: result.posture || "unknown"
  };
};
