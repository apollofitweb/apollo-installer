import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { ToastProvider } from '../lib/toast';

// Mock the API
vi.mock('../lib/api', () => ({
  api: {
    getDeployments: vi.fn(),
    startDeployment: vi.fn(),
    resumeDeployment: vi.fn(),
    deleteDeployment: vi.fn(),
  },
}));

import { api } from '../lib/api';

const mockDeployments = [
  {
    id: '1',
    slug: 'filial-1',
    name: 'Filial 1',
    status: 'COMPLETED' as const,
    currentStep: 5,
    totalSteps: 5,
    domain: 'filial1.example.com',
    adminName: 'Admin 1',
    adminEmail: 'admin1@test.com',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    steps: [],
  },
  {
    id: '2',
    slug: 'filial-2',
    name: 'Filial 2',
    status: 'IN_PROGRESS' as const,
    currentStep: 2,
    totalSteps: 5,
    domain: null,
    adminName: 'Admin 2',
    adminEmail: 'admin2@test.com',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    steps: [],
  },
];

const renderDashboard = () => {
  return render(
    <BrowserRouter>
      <ToastProvider>
        <Dashboard />
      </ToastProvider>
    </BrowserRouter>
  );
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    (api.getDeployments as any).mockImplementation(() => new Promise(() => {}));
    const { container } = renderDashboard();
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('renders deployment stats', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 2 },
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Concluídos')).toBeInTheDocument());
    expect(screen.getAllByText('1').length).toBeGreaterThan(0); // completed/in progress counts
    expect(screen.getAllByText('Em Progresso').length).toBeGreaterThan(0);
  });

  it('renders empty state when no deployments', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: [],
      pagination: { totalPages: 1, total: 0 },
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Nenhum deployment encontrado')).toBeInTheDocument());
  });

  it('shows error state on API failure', async () => {
    (api.getDeployments as any).mockRejectedValue(new Error('API Error'));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Erro ao carregar deployments')).toBeInTheDocument());
  });

  it('calls startDeployment when Iniciar clicked', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: [{ ...mockDeployments[0], status: 'PENDING' }],
      pagination: { totalPages: 1, total: 1 },
    });
    (api.startDeployment as any).mockResolvedValue(undefined);
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Iniciar')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Iniciar'));
    await waitFor(() => expect(api.startDeployment).toHaveBeenCalledWith('1'));
  });

  it('calls deleteDeployment when Excluir clicked and confirms', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 2 },
    });
    (api.deleteDeployment as any).mockResolvedValue(undefined);
    window.confirm = vi.fn(() => true);
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Excluir')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Excluir'));
    await waitFor(() => expect(api.deleteDeployment).toHaveBeenCalledWith('1'));
  });

  it('does not call deleteDeployment when cancelled', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 2 },
    });
    window.confirm = vi.fn(() => false);
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Excluir')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Excluir'));
    await waitFor(() => expect(api.deleteDeployment).not.toHaveBeenCalled());
  });
});