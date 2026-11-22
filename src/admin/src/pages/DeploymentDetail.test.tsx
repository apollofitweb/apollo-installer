import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DeploymentDetail } from './DeploymentDetail';
import { ToastProvider } from '../lib/toast';

vi.mock('../lib/api', () => ({
  api: {
    getDeployment: vi.fn(),
    startDeployment: vi.fn(),
    resumeDeployment: vi.fn(),
    deleteDeployment: vi.fn(),
    updateDeploymentConfig: vi.fn(),
  },
}));

import { api } from '../lib/api';

const mockDeployment = {
  id: '1',
  slug: 'filial-sp',
  name: 'Filial São Paulo',
  status: 'COMPLETED',
  currentStep: 5,
  totalSteps: 5,
  domain: 'filial-sp.apollofit.com.br',
  adminName: 'Admin',
  adminEmail: 'admin@test.com',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  completedAt: '2024-01-01T01:00:00Z',
  errorMessage: null,
  steps: [
    { stepNumber: 1, name: 'supabase_create', status: 'COMPLETED', startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:10:00Z', errorMessage: null, metadata: { projectRef: 'abc' } },
    { stepNumber: 2, name: 'supabase_migrate_seed', status: 'COMPLETED', startedAt: '2024-01-01T00:10:00Z', completedAt: '2024-01-01T00:30:00Z', errorMessage: null, metadata: {} },
    { stepNumber: 3, name: 'render_create', status: 'COMPLETED', startedAt: '2024-01-01T00:30:00Z', completedAt: '2024-01-01T00:45:00Z', errorMessage: null, metadata: {} },
    { stepNumber: 4, name: 'render_configure', status: 'COMPLETED', startedAt: '2024-01-01T00:45:00Z', completedAt: '2024-01-01T00:50:00Z', errorMessage: null, metadata: {} },
    { stepNumber: 5, name: 'netlify_deploy', status: 'COMPLETED', startedAt: '2024-01-01T00:50:00Z', completedAt: '2024-01-01T01:00:00Z', errorMessage: null, metadata: {} },
  ],
  config: {
    supabaseProjectRef: 'abc123',
    publicApiUrl: 'https://api.filial-sp.apollofit.com.br',
  },
};

interface DeploymentTestData {
  id: string;
  slug: string;
  name: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  domain: string | null;
  adminName: string;
  adminEmail: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorMessage: string | null;
  steps: Array<{ stepNumber: number; name: string; status: string; startedAt: string; completedAt: string; errorMessage: string | null; metadata: Record<string, unknown> }>;
  config?: Record<string, unknown>;
}

const renderDeploymentDetail = (deployment: DeploymentTestData = mockDeployment) => {
  (api.getDeployment as any).mockResolvedValue(deployment);
  return render(
    <MemoryRouter initialEntries={[`/deployments/${deployment.id}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/deployments/:id" element={<DeploymentDetail />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
};

describe('DeploymentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    (api.getDeployment as any).mockImplementation(() => new Promise(() => {}));
    const { container } = render(
      <MemoryRouter initialEntries={['/deployments/1']}>
        <ToastProvider>
          <Routes>
            <Route path="/deployments/:id" element={<DeploymentDetail />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    );
    expect(container.querySelector('.spinner')).toBeTruthy(); // spinner
  });

  it('renders error state on API failure', async () => {
    (api.getDeployment as any).mockRejectedValue(new Error('Not found'));
    render(
      <MemoryRouter initialEntries={['/deployments/1']}>
        <ToastProvider>
          <Routes>
            <Route path="/deployments/:id" element={<DeploymentDetail />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Erro ao carregar deployment')).toBeInTheDocument());
  });

  it('renders deployment details', async () => {
    renderDeploymentDetail();
    await waitFor(() => expect(screen.getAllByText('Filial São Paulo').length).toBeGreaterThan(0));
    expect(screen.getAllByText('filial-sp').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Concluído').length).toBeGreaterThan(0);
    expect(screen.getAllByText('filial-sp.apollofit.com.br').length).toBeGreaterThan(0);
  });

  it('renders step progress', async () => {
    renderDeploymentDetail();
    await waitFor(() => expect(screen.getByText('Progresso do Deployment')).toBeInTheDocument());
    expect(screen.getByText('5 / 5')).toBeInTheDocument();
  });

  it('shows start button for PENDING status', async () => {
    const pendingDeployment = { ...mockDeployment, status: 'PENDING' };
    renderDeploymentDetail(pendingDeployment);
    await waitFor(() => expect(screen.getByText('Iniciar')).toBeInTheDocument());
  });

  it('shows resume button for FAILED status', async () => {
    const failedDeployment = { ...mockDeployment, status: 'FAILED' };
    renderDeploymentDetail(failedDeployment);
    await waitFor(() => expect(screen.getByText('Retomar')).toBeInTheDocument());
  });

  it('shows delete button for COMPLETED status', async () => {
    renderDeploymentDetail();
    await waitFor(() => expect(screen.getByText('Excluir')).toBeInTheDocument());
  });

  it('calls startDeployment when Iniciar clicked', async () => {
    const pendingDeployment = { ...mockDeployment, status: 'PENDING' };
    (api.startDeployment as any).mockResolvedValue(undefined);
    renderDeploymentDetail(pendingDeployment);
    await waitFor(() => expect(screen.getByText('Iniciar')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Iniciar'));
    await waitFor(() => expect(api.startDeployment).toHaveBeenCalledWith('1'));
  });

  it('calls deleteDeployment when Excluir confirmed', async () => {
    (api.deleteDeployment as any).mockResolvedValue(undefined);
    renderDeploymentDetail();
    await waitFor(() => expect(screen.getByText('Excluir')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Excluir'));
    await waitFor(() => expect(screen.getByText('Confirmar Exclusão')).toBeInTheDocument());
    const confirmButtons = screen.getAllByText('Excluir');
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(api.deleteDeployment).toHaveBeenCalledWith('1'));
  });

  it('cancels delete when Cancelar clicked', async () => {
    renderDeploymentDetail();
    await waitFor(() => expect(screen.getByText('Excluir')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Excluir'));
    await waitFor(() => expect(screen.getByText('Confirmar Exclusão')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cancelar'));
    await waitFor(() => expect(api.deleteDeployment).not.toHaveBeenCalled());
  });

  it('renders step details with metadata', async () => {
    renderDeploymentDetail();
    await waitFor(() => expect(screen.getByText('Detalhes dos Passos')).toBeInTheDocument());
    expect(screen.getAllByText('supabase create').length).toBeGreaterThan(0);
    expect(screen.getByText('Ver metadados do passo')).toBeInTheDocument();
  });

  it('renders config section when config exists', async () => {
    renderDeploymentDetail();
    await waitFor(() => expect(screen.getByText('Configuração Operacional')).toBeInTheDocument());
    expect(screen.getByText('abc123')).toBeInTheDocument();
  });
});