import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { NewDeployment } from './NewDeployment';
import { ToastProvider } from '../lib/toast';

vi.mock('../lib/api', () => ({
  api: {
    createDeployment: vi.fn(),
  },
}));

import { api } from '../lib/api';

const renderNewDeployment = () => {
  return render(
    <BrowserRouter>
      <ToastProvider>
        <NewDeployment />
      </ToastProvider>
    </BrowserRouter>
  );
};

describe('NewDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form with all sections', () => {
    renderNewDeployment();
    expect(screen.getByText('Nova Instalação')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Slug/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nome(?! do Admin)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email do Admin/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nome do Admin/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Senha do Admin/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Domínio Personalizado/)).toBeInTheDocument();
    expect(screen.getByText('Configurações de Pagamento (Mercado Pago)')).toBeInTheDocument();
    expect(screen.getByText('Configurações SMTP (Opcional)')).toBeInTheDocument();
    expect(screen.getByText('Configurações Operacionais')).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    renderNewDeployment();
    const submitButton = screen.getByText('Criar Instalação');
    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(screen.getByText('Slug é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Nome é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Email do admin é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Nome do admin é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('Senha do admin é obrigatória (mínimo 8 caracteres)')).toBeInTheDocument();
    });
  });

  it('sanitizes slug input', async () => {
    renderNewDeployment();
    const slugInput = screen.getByLabelText(/^Slug/);
    fireEvent.change(slugInput, { target: { value: 'Invalid_Slug' } });
    await waitFor(() => expect(slugInput).toHaveValue('invalid-slug'));
  });

  it('validates email format', async () => {
    renderNewDeployment();
    const emailInput = screen.getByLabelText(/^Email do Admin/);
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.blur(emailInput);
    await waitFor(() => expect(screen.getByText('Email inválido')).toBeInTheDocument());
  });

  it('auto-generates domain from slug', async () => {
    renderNewDeployment();
    const slugInput = screen.getByLabelText(/^Slug/);
    fireEvent.change(slugInput, { target: { value: 'filial-sp' } });
    fireEvent.blur(slugInput);
    await waitFor(() => expect(screen.getByLabelText(/^Domínio Personalizado/)).toHaveValue('filial-sp.apollofit.com.br'));
  });

  it('toggles Mercado Pago mode select', async () => {
    renderNewDeployment();
    expect(screen.queryByLabelText('Modo')).not.toBeInTheDocument();
    const mpCheckbox = screen.getByLabelText('Habilitar Mercado Pago');
    fireEvent.click(mpCheckbox);
    await waitFor(() => expect(screen.getByLabelText('Modo')).toBeInTheDocument());
  });

  it('toggles SMTP fields', async () => {
    renderNewDeployment();
    expect(screen.queryByLabelText(/^Host SMTP/)).not.toBeInTheDocument();
    const smtpCheckbox = screen.getByLabelText('Configurar SMTP personalizado');
    fireEvent.click(smtpCheckbox);
    await waitFor(() => expect(screen.getByLabelText(/^Host SMTP/)).toBeInTheDocument());
  });

  it('validates SMTP fields when enabled', async () => {
    renderNewDeployment();
    const smtpCheckbox = screen.getByLabelText('Configurar SMTP personalizado');
    fireEvent.click(smtpCheckbox);
    const submitButton = screen.getByText('Criar Instalação');
    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(screen.getByText('SMTP host é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('SMTP port é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('SMTP user é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('SMTP pass é obrigatório')).toBeInTheDocument();
      expect(screen.getByText('SMTP from é obrigatório')).toBeInTheDocument();
    });
  });

  it('calls createDeployment on valid submit', async () => {
    (api.createDeployment as any).mockResolvedValue({ id: '123', slug: 'filial-sp', status: 'PENDING' });
    renderNewDeployment();

    fireEvent.change(screen.getByLabelText(/^Slug/), { target: { value: 'filial-sp' } });
    fireEvent.change(screen.getByLabelText(/^Nome(?! do Admin)/), { target: { value: 'Filial São Paulo' } });
    fireEvent.change(screen.getByLabelText(/^Email do Admin/), { target: { value: 'admin@test.com' } });
    fireEvent.change(screen.getByLabelText(/^Nome do Admin/), { target: { value: 'Admin Test' } });
    fireEvent.change(screen.getByLabelText(/^Senha do Admin/), { target: { value: 'SenhaForte123' } });

    const submitButton = screen.getByText('Criar Instalação');
    fireEvent.click(submitButton);

    await waitFor(() => expect(api.createDeployment).toHaveBeenCalled());
    const callArgs = (api.createDeployment as any).mock.calls[0][0];
    expect(callArgs.slug).toBe('filial-sp');
    expect(callArgs.name).toBe('Filial São Paulo');
    expect(callArgs.adminEmail).toBe('admin@test.com');
    expect(callArgs.adminName).toBe('Admin Test');
  });
});
