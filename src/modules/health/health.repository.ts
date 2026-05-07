export type RuntimeInfo = {
  uptime: number;
  timestamp: string;
};

export interface HealthRepository {
  getRuntimeInfo(): RuntimeInfo;
}

export class SystemHealthRepository implements HealthRepository {
  getRuntimeInfo(): RuntimeInfo {
    return {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
