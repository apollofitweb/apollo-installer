import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, Deployment, CreateDeploymentInput, UpdateConfigInput, DeploymentSecretMetadata, GlobalSecretMetadata, SecretValue, PaginatedResponse } from '../types';

// VITE_API_URL pode vir sem o sufixo /api (configurado no Netlify) ou já com ele.
// Normalizamos para que todas as chamadas de negócio usem /api, enquanto /health
// continua na raiz da API (é onde o Render o registra).
const RAW_API_URL = String((import.meta as any).env?.VITE_API_URL || '/api').replace(/\/$/, '');
const API_ORIGIN = RAW_API_URL.replace(/\/api$/, '');
const API_BASE_URL = `${API_ORIGIN}/api`;

class ApiClient {
  private client: AxiosInstance;
  private healthClient: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      // O Render (plano free) pode levar ~30-60s para acordar após inatividade.
      // 30s causava "timeout of 30000ms exceeded" no primeiro login do dia.
      timeout: 120000,
    });

    // /health não tem prefixo /api no backend. Manter um cliente separado evita
    // que o warm-up do Render caia no SPA fallback e retorne index.html.
    this.healthClient = axios.create({
      baseURL: API_ORIGIN || undefined,
      timeout: 120000,
    });

    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ message?: string; error?: string }>) => {
        const isLoginRequest = error.config?.url?.includes('/auth/login');
        if (error.response?.status === 401 && !isLoginRequest) {
          this.clearToken();
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }

        // Surface the API error message instead of the generic axios message
        const serverMessage = error.response?.data?.message || error.response?.data?.error;
        if (serverMessage) {
          error.message = serverMessage;
        } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
          error.message = 'A API está inicializando. Aguarde um instante e tente novamente.';
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('admin_token', token);
    } else {
      localStorage.removeItem('admin_token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('admin_token');
    }
    return this.token;
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('admin_token');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  // Authentication
  async login(email: string, password: string): Promise<{ token: string; user: { email: string; role: string } }> {
    const response = await this.client.post<ApiResponse<{ token: string; user: { email: string; role: string } }>>(
      '/auth/login',
      { email, password }
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Credenciais inválidas');
    }
    this.setToken(response.data.data.token);
    return response.data.data;
  }

  async me(): Promise<{ email: string; role: string }> {
    const response = await this.client.get<ApiResponse<{ email: string; role: string }>>('/auth/me');
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Sessão inválida');
    }
    return response.data.data;
  }

  logout(): void {
    this.clearToken();
  }

  // Deployments
  async getDeployments(page = 1, limit = 20): Promise<PaginatedResponse<Deployment>> {
    const response = await this.client.get<ApiResponse<Deployment[]>>('/deployments', {
      params: { page, limit },
    });
    return {
      success: response.data.success,
      data: response.data.data || [],
      pagination: (response.data as any).pagination,
    };
  }

  async getDeployment(id: string): Promise<Deployment> {
    const response = await this.client.get<ApiResponse<Deployment>>(`/deployments/${id}`);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Deployment not found');
    }
    return response.data.data;
  }

  async getDeploymentBySlug(slug: string): Promise<Deployment> {
    const response = await this.client.get<ApiResponse<Deployment>>(`/deployments/slug/${slug}`);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Deployment not found');
    }
    return response.data.data;
  }

  async createDeployment(input: CreateDeploymentInput): Promise<{ id: string; slug: string; status: string }> {
    const response = await this.client.post<ApiResponse<{ id: string; slug: string; status: string }>>('/deployments', input);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to create deployment');
    }
    return response.data.data;
  }

  async updateDeploymentConfig(id: string, config: UpdateConfigInput): Promise<DeploymentConfig> {
    const response = await this.client.patch<ApiResponse<DeploymentConfig>>(`/deployments/${id}/config`, config);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to update config');
    }
    return response.data.data;
  }

  async startDeployment(id: string, config: Record<string, unknown> = {}): Promise<void> {
    const response = await this.client.post<ApiResponse<{ message: string }>>(`/deployments/${id}/start`, config);
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to start deployment');
    }
  }

  async resumeDeployment(id: string): Promise<void> {
    const response = await this.client.post<ApiResponse<{ message: string }>>(`/deployments/${id}/resume`);
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to resume deployment');
    }
  }

  async deleteDeployment(id: string): Promise<void> {
    const response = await this.client.delete<ApiResponse<{ message: string }>>(`/deployments/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to delete deployment');
    }
  }

  // Deployment Secrets
  async setDeploymentSecret(deploymentId: string, key: string, value: string, expectedVersion = 0): Promise<DeploymentSecretMetadata> {
    const response = await this.client.post<ApiResponse<DeploymentSecretMetadata>>(
      `/deployments/${deploymentId}/secrets`,
      { key, value, expectedVersion }
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to set secret');
    }
    return response.data.data;
  }

  async getDeploymentSecret(deploymentId: string, key: string): Promise<string> {
    const response = await this.client.get<ApiResponse<SecretValue>>(`/deployments/${deploymentId}/secrets/${key}`);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Secret not found');
    }
    return response.data.data.value;
  }

  async getDeploymentSecretMeta(deploymentId: string, key: string): Promise<DeploymentSecretMetadata> {
    const response = await this.client.get<ApiResponse<DeploymentSecretMetadata>>(`/deployments/${deploymentId}/secrets/${key}/meta`);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Secret not found');
    }
    return response.data.data;
  }

  async listDeploymentSecrets(deploymentId: string): Promise<Record<string, DeploymentSecretMetadata>> {
    const response = await this.client.get<ApiResponse<Record<string, DeploymentSecretMetadata>>>(`/deployments/${deploymentId}/secrets`);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to list secrets');
    }
    return response.data.data;
  }

  async deleteDeploymentSecret(deploymentId: string, key: string, expectedVersion: number): Promise<void> {
    const response = await this.client.delete<ApiResponse<{ message: string }>>(
      `/deployments/${deploymentId}/secrets/${key}`,
      { data: { expectedVersion } }
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to delete secret');
    }
  }

  // Global Secrets
  async setGlobalSecret(key: string, value: string, expectedVersion = 0): Promise<GlobalSecretMetadata> {
    const response = await this.client.post<ApiResponse<GlobalSecretMetadata>>(
      '/secrets/global',
      { key, value, expectedVersion }
    );
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to set global secret');
    }
    return response.data.data;
  }

  async getGlobalSecret(key: string): Promise<string> {
    const response = await this.client.get<ApiResponse<SecretValue>>(`/secrets/global/${key}`);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Secret not found');
    }
    return response.data.data.value;
  }

  async getGlobalSecretMeta(key: string): Promise<GlobalSecretMetadata> {
    const response = await this.client.get<ApiResponse<GlobalSecretMetadata>>(`/secrets/global/${key}/meta`);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Secret not found');
    }
    return response.data.data;
  }

  async listGlobalSecrets(): Promise<Record<string, GlobalSecretMetadata>> {
    const response = await this.client.get<ApiResponse<Record<string, GlobalSecretMetadata>>>('/secrets/global');
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to list global secrets');
    }
    return response.data.data;
  }

  async deleteGlobalSecret(key: string, expectedVersion: number): Promise<void> {
    const response = await this.client.delete<ApiResponse<{ message: string }>>(
      `/secrets/global/${key}`,
      { data: { expectedVersion } }
    );
    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to delete global secret');
    }
  }

  // Health
  async healthCheck(): Promise<{ status: string }> {
    const response = await this.healthClient.get<ApiResponse<{ status: string }>>('/health');
    return response.data.data || { status: 'unknown' };
  }
}

export const api = new ApiClient();

// Types for config update
export interface DeploymentConfig {
  id: string;
  deploymentId: string;
  supabaseProjectRef: string | null;
  supabaseRegion: string | null;
  renderServiceId: string | null;
  netlifySiteId: string | null;
  customDomain: string | null;
  repo: string | null;
  branch: string | null;
  dockerfilePath: string | null;
  publicApiUrl: string | null;
  allowedOrigins: string | null;
  mercadoPagoEnabled: boolean;
  mercadoPagoMode: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  createdAt: string;
  updatedAt: string;
}