import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Credentials } from './Credentials';
import { ToastProvider } from '../lib/toast';

vi.mock('../lib/api', () => ({
  api: {
    getDeployments: vi.fn(),
    listDeploymentSecrets: vi.fn(),
    listGlobalSecrets: vi.fn(),
    setDeploymentSecret: vi.fn(),
    setGlobalSecret: vi.fn(),
    getDeploymentSecret: vi.fn(),
    getGlobalSecret: vi.fn(),
    deleteDeploymentSecret: vi.fn(),
    deleteGlobalSecret: vi.fn(),
  },
}));

import { api } from '../lib/api';

const mockDeployments = [
  { id: '1', slug: 'filial-1', name: 'Filial 1' },
  { id: '2', slug: 'filial-2', name: 'Filial 2' },
];

const mockDeploymentSecrets = {
  dbPassword: { version: 1, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin', deleted: false },
  jwtAccessSecret: { version: 1, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin', deleted: false },
};

const mockGlobalSecrets = {
  'netlify.siteId': { version: 1, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin', deleted: false },
  'netlify.authToken': { version: 1, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin', deleted: false },
  'installer.jwtSigningSecret': { version: 1, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin', deleted: false },
  'supabase.accessToken': { version: 1, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin', deleted: false },
};

const renderCredentials = () => {
  return render(
    <BrowserRouter>
      <ToastProvider>
        <Credentials />
      </ToastProvider>
    </BrowserRouter>
  );
};

describe('Credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    (api.getDeployments as any).mockImplementation(() => new Promise(() => {}));
    renderCredentials();
    expect(screen.getByText('Gerenciamento de Credenciais')).toBeInTheDocument();
  });

  it('renders global secrets section', async () => {
    (api.getDeployments as any).mockResolvedValue({ data: mockDeployments, pagination: { totalPages: 1, total: 2 } });
    (api.listGlobalSecrets as any).mockResolvedValue(mockGlobalSecrets);
    (api.listDeploymentSecrets as any).mockResolvedValue({});

    renderCredentials();
    await waitFor(() => expect(screen.getByText('Segredos Globais')).toBeInTheDocument());
    expect(screen.getByText('netlify.siteId')).toBeInTheDocument();
    expect(screen.getByText('netlify.authToken')).toBeInTheDocument();
    expect(screen.getByText('installer.jwtSigningSecret')).toBeInTheDocument();
    expect(screen.getByText('supabase.accessToken')).toBeInTheDocument();
  });

  it('renders deployment secrets section when deployment selected', async () => {
    (api.getDeployments as any).mockResolvedValue({ data: mockDeployments, pagination: { totalPages: 1, total: 2 } });
    (api.listGlobalSecrets as any).mockResolvedValue({});
    (api.listDeploymentSecrets as any).mockResolvedValue(mockDeploymentSecrets);

    renderCredentials();
    await waitFor(() => expect(screen.getAllByText('Selecione uma filial').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    await waitFor(() => {
      expect(screen.getByText('Segredos por Filial')).toBeInTheDocument();
      expect(screen.getByText('dbPassword')).toBeInTheDocument();
      expect(screen.getByText('jwtAccessSecret')).toBeInTheDocument();
    });
  });

  it('shows "Não configurado" for missing secrets', async () => {
    (api.getDeployments as any).mockResolvedValue({ data: mockDeployments, pagination: { totalPages: 1, total: 2 } });
    (api.listGlobalSecrets as any).mockResolvedValue({});
    (api.listDeploymentSecrets as any).mockResolvedValue({});

    renderCredentials();
    await waitFor(() => expect(screen.getAllByText('Não configurado').length).toBeGreaterThan(0));
  });

  it('opens add secret modal when Adicionar clicked', async () => {
    (api.getDeployments as any).mockResolvedValue({ data: mockDeployments, pagination: { totalPages: 1, total: 2 } });
    (api.listGlobalSecrets as any).mockResolvedValue({});
    (api.listDeploymentSecrets as any).mockResolvedValue({});

    renderCredentials();
    await waitFor(() => expect(screen.getAllByText('Adicionar').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Adicionar')[0]);
    await waitFor(() => expect(screen.getByText(/Adicionar Segredo/)).toBeInTheDocument());
  });

  it('never exposes saved secret values', async () => {
    (api.getDeployments as any).mockResolvedValue({ data: mockDeployments, pagination: { totalPages: 1, total: 2 } });
    (api.listGlobalSecrets as any).mockResolvedValue(mockGlobalSecrets);
    (api.listDeploymentSecrets as any).mockResolvedValue({});

    renderCredentials();
    await waitFor(() => expect(screen.getByText('Segredos Globais')).toBeInTheDocument());
    expect(screen.queryByText('secret-value')).not.toBeInTheDocument();
    expect(api.getGlobalSecret).not.toHaveBeenCalled();
    expect(api.getDeploymentSecret).not.toHaveBeenCalled();
  });

  it('calls setGlobalSecret when saving global secret', async () => {
    (api.getDeployments as any).mockResolvedValue({ data: mockDeployments, pagination: { totalPages: 1, total: 2 } });
    (api.listGlobalSecrets as any).mockResolvedValue({});
    (api.listDeploymentSecrets as any).mockResolvedValue({});
    (api.setGlobalSecret as any).mockResolvedValue({ version: 1, updatedAt: '2024-01-01T00:00:00Z', updatedBy: 'admin', deleted: false });

    renderCredentials();
    await waitFor(() => expect(screen.getAllByText('Adicionar').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Adicionar')[0]);
    await waitFor(() => expect(screen.getByLabelText(/^Valor do Segredo/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Valor do Segredo/), { target: { value: 'new-secret-value' } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(api.setGlobalSecret).toHaveBeenCalledWith('netlify.siteId', 'new-secret-value', 0));
  });

  it('calls deleteGlobalSecret when Excluir clicked and confirmed', async () => {
    (api.getDeployments as any).mockResolvedValue({ data: mockDeployments, pagination: { totalPages: 1, total: 2 } });
    (api.listGlobalSecrets as any).mockResolvedValue(mockGlobalSecrets);
    (api.listDeploymentSecrets as any).mockResolvedValue({});
    (api.deleteGlobalSecret as any).mockResolvedValue(undefined);
    window.confirm = vi.fn(() => true);

    renderCredentials();
    await waitFor(() => expect(screen.getAllByText('Excluir').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Excluir')[0]);
    await waitFor(() => expect(api.deleteGlobalSecret).toHaveBeenCalled());
  });
});