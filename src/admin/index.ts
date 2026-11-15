/**
 * Admin Interface - Placeholder for OS-002
 * OS-002: Structure only - no UI implementation yet
 * This module will contain the administrative dashboard for monitoring deployments
 */

export interface AdminInterfaceConfig {
  apiUrl: string;
  refreshIntervalMs: number;
}

export interface DeploymentSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
}

export class AdminInterface {
  private config: AdminInterfaceConfig;

  constructor(config: AdminInterfaceConfig) {
    this.config = config;
  }

  async getDeployments(): Promise<DeploymentSummary[]> {
    // TODO: Implement API call to /api/deployments
    return [];
  }

  async getDeployment(_id: string): Promise<DeploymentSummary | null> {
    // TODO: Implement API call to /api/deployments/:id
    return null;
  }

  subscribeToUpdates(_callback: (deployment: DeploymentSummary) => void): () => void {
    // TODO: Implement WebSocket or polling subscription
    return () => {};
  }
}

export function createAdminInterface(config: AdminInterfaceConfig): AdminInterface {
  return new AdminInterface(config);
}