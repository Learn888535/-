
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { DetectionResult } from "../types";

// Removed global API_KEY constant to use process.env.API_KEY directly as per guidelines

export const analyzeScene = async (base64Image: string): Promise<DetectionResult> => {
  // Use process.env.API_KEY directly in constructor
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    Analyze this camera frame for elderly safety monitoring.
    Role: Senior Health & Safety AI.
    
    Task:
    1. Look for a person.
    2. Identify posture: standing (站立), sitting (坐姿), lying (卧姿), or none (无人).
    3. Check for "FALL" (unexpected position on floor).
    4. Reasoning: Provide a short, comforting observation in Chinese (e.g., "观察到老人正在沙发上休息", "目前室内未检测到人员").

    Return ONLY valid JSON:
    {
      "isFallDetected": boolean,
      "confidence": number (0 to 1),
      "reasoning": "string (Chinese)",
      "posture": "standing" | "sitting" | "lying" | "none"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    });

    // Extract text directly from getter
    const text = response.text || "{}";
    const data = JSON.parse(text);
    return {
      isFallDetected: !!data.isFallDetected,
      confidence: data.confidence ?? 0,
      reasoning: data.reasoning || "分析引擎已就绪",
      posture: data.posture || "none"
    };
  } catch (error) {
    console.error("Vision analysis failed", error);
    return { 
      isFallDetected: false, 
      confidence: 0, 
      reasoning: "正在同步视觉传感器数据...", 
      posture: "unknown" 
    };
  }
};

export const createLiveSession = async (callbacks: any) => {
  // Use process.env.API_KEY directly in constructor
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
      },
      systemInstruction: '你是一个紧急救援AI。如果检测到老人跌倒，请用亲切、平静的中文询问。如无回应，请说：正在联系紧急联络人并拨打120。'
    }
  });
};
