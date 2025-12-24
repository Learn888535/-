
export enum SystemStatus {
  IDLE = 'IDLE',
  MONITORING = 'MONITORING',
  ALERT = 'ALERT',
  EMERGENCY = 'EMERGENCY'
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
  status: 'info' | 'warning' | 'danger';
}
