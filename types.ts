
export enum SystemStatus {
  IDLE = 'IDLE',
  MONITORING = 'MONITORING',
  ALERT = 'ALERT',
  EMERGENCY = 'EMERGENCY'
}

export enum InferenceMode {
  CLOUD = 'CLOUD',
  LOCAL = 'LOCAL',
  CUSTOM = 'CUSTOM'
}

export interface DetectionResult {
  isFallDetected: boolean;
  confidence: number;
  reasoning: string;
  posture: string;
}

export interface ActivityLog {
  id: string;
  timestamp: Date;
  event: string;
  type: 'fall' | 'human' | 'system' | 'contact';
  status: 'info' | 'warning' | 'danger';
  note?: string; 
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation: string;
  isPrimary: boolean;
}

export interface SystemConfig {
  mode: InferenceMode;
  localEndpoint: string;
  localModel: string;
  customBaseUrl: string;
  customApiKey: string;
  customModel: string;
  contacts: EmergencyContact[];
  ttsLanguage: string;
  ttsRate: number;
  ttsVoiceName?: string;
  voiceType: 'ai' | 'local' | 'custom_api'; // 新增：支持自定义 API 语音
  aiVoiceName: string;
  customTtsUrl: string; // 新增：自定义 TTS API 地址
  customTtsApiKey: string; // 新增：自定义 TTS API Key
  customTtsModel: string; // 新增：自定义 TTS 模型名
}
