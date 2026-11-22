import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { DeploymentHistory } from './DeploymentHistory';
import { ToastProvider } from '../lib/toast';

vi.mock('../lib/api', () => ({
  api: {
    getDeployments: vi.fn(),
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
  },
  {
    id: '2',
    slug: 'filial-2',
    name: 'Filial 2',
    status: 'FAILED' as const,
    currentStep: 2,
    totalSteps: 5,
    domain: null,
    adminName: 'Admin 2',
    adminEmail: 'admin2@test.com',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
  {
    id: '3',
    slug: 'filial-3',
    name: 'Filial 3',
    status: 'IN_PROGRESS' as const,
    currentStep: 3,
    totalSteps: 5,
    domain: null,
    adminName: 'Admin 3',
    adminEmail: 'admin3@test.com',
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-03T00:00:00Z',
  },
];

const renderHistory = () => {
  return render(
    <BrowserRouter>
      <ToastProvider>
        <DeploymentHistory />
      </ToastProvider>
    </BrowserRouter>
  );
};

describe('DeploymentHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    (api.getDeployments as any).mockImplementation(() => new Promise(() => {}));
    const { container } = renderHistory();
    expect(container.querySelector('.spinner')).toBeTruthy(); // spinner
  });

  it('renders deployments table', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 3 },
    });
    renderHistory();
    await waitFor(() => expect(screen.getByText('Filial 1')).toBeInTheDocument());
    expect(screen.getByText('Filial 2')).toBeInTheDocument();
    expect(screen.getByText('Filial 3')).toBeInTheDocument();
  });

  it('shows delete button for COMPLETED status', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 3 },
    });
    renderHistory();
    await waitFor(() => {
      // First row (Filial 1 - COMPLETED) should have delete button
      expect(screen.getAllByText('Excluir').length).toBeGreaterThan(0);
    });
  });

  it('does not show delete button for IN_PROGRESS status', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 3 },
    });
    renderHistory();
    await waitFor(() => {
      // Filial 3 is IN_PROGRESS, should not have delete button
      // We can't easily test per-row, but we can check the button count
      const deleteButtons = screen.getAllByText('Excluir');
      // Only Filial 1 (COMPLETED) and Filial 2 (FAILED) should have delete = 2 buttons
      expect(deleteButtons.length).toBe(2);
    });
  });

  it('filters by search query', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 3 },
    });
    renderHistory();
    await waitFor(() => expect(screen.getByText('Filial 1')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Buscar por slug, nome, email ou domínio...'), { target: { value: 'Filial 1' } });
    await waitFor(() => {
      expect(screen.getByText('Filial 1')).toBeInTheDocument();
      expect(screen.queryByText('Filial 2')).not.toBeInTheDocument();
      expect(screen.queryByText('Filial 3')).not.toBeInTheDocument();
    });
  });

  it('filters by status', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 3 },
    });
    renderHistory();
    await waitFor(() => expect(screen.getByText('Filial 1')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Filtrar por Status'), { target: { value: 'COMPLETED' } });
    await waitFor(() => {
      expect(screen.getByText('Filial 1')).toBeInTheDocument();
      expect(screen.queryByText('Filial 2')).not.toBeInTheDocument();
      expect(screen.queryByText('Filial 3')).not.toBeInTheDocument();
    });
  });

  it('calls deleteDeployment when Excluir clicked and confirmed', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 3 },
    });
    (api.deleteDeployment as any).mockResolvedValue(undefined);
    window.confirm = vi.fn(() => true);
    renderHistory();
    await waitFor(() => expect(screen.getAllByText('Excluir').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Excluir')[0]);
    await waitFor(() => expect(api.deleteDeployment).toHaveBeenCalled());
  });

  it('does not call deleteDeployment when cancelled', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: mockDeployments,
      pagination: { totalPages: 1, total: 3 },
    });
    window.confirm = vi.fn(() => false);
    renderHistory();
    await waitFor(() => expect(screen.getAllByText('Excluir').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Excluir')[0]);
    await waitFor(() => expect(api.deleteDeployment).not.toHaveBeenCalled());
  });

  it('renders empty state when no deployments', async () => {
    (api.getDeployments as any).mockResolvedValue({
      data: [],
      pagination: { totalPages: 1, total: 0 },
    });
    renderHistory();
    await waitFor(() => expect(screen.getByText('Nenhum deployment cadastrado')).toBeInTheDocument());
  });
});