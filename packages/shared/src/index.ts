export const gatewayName = 'erwin-gateway' as const;

export type HealthStatus = 'healthy' | 'ready' | 'degraded';

export interface HealthResponse {
  status: HealthStatus;
  service: typeof gatewayName;
  timestamp: string;
  version: string;
}
