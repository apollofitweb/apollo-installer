import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { CreateDeploymentInput, SmtpConfigInput } from '../types';
import {
  Card, CardHeader, CardContent,
  Button, Input, Select
} from '../components/common';
import { useToast } from '../lib/toast';

const MERCADO_PAGO_MODES = [
  { value: 'sandbox', label: 'Sandbox (Teste)' },
  { value: 'production', label: 'Produção' },
];

const DEFAULT_CONFIG = {
  repo: 'apollofitweb/apollo-web',
  branch: 'develop',
  dockerfilePath: 'docker/Dockerfile',
};

export function NewDeployment() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [smtpEnabled, setSmtpEnabled] = useState(false);

  const [formData, setFormData] = useState<CreateDeploymentInput>({
    slug: '',
    name: '',
    domain: '',
    adminEmail: '',
    adminName: '',
    adminPassword: '',
    customDomain: false,
    mercadoPagoEnabled: false,
    mercadoPagoMode: 'sandbox',
    smtpConfig: undefined,
    repo: DEFAULT_CONFIG.repo,
    branch: DEFAULT_CONFIG.branch,
    dockerfilePath: DEFAULT_CONFIG.dockerfilePath,
    publicApiUrl: '',
  });

  const validateField = (name: string, value: unknown): string | null => {
    switch (name) {
      case 'slug':
        if (!value || (value as string).trim() === '') return 'Slug é obrigatório';
        if (!/^[a-z0-9-]+$/.test(value as string)) return 'Slug deve conter apenas letras minúsculas, números e hífens';
        if ((value as string).length < 2 || (value as string).length > 50) return 'Slug deve ter entre 2 e 50 caracteres';
        return null;
      case 'name':
        if (!value || (value as string).trim() === '') return 'Nome é obrigatório';
        if ((value as string).length < 2 || (value as string).length > 100) return 'Nome deve ter entre 2 e 100 caracteres';
        return null;
      case 'adminEmail':
        if (!value || (value as string).trim() === '') return 'Email do admin é obrigatório';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value as string)) return 'Email inválido';
        return null;
      case 'adminName':
        if (!value || (value as string).trim() === '') return 'Nome do admin é obrigatório';
        if ((value as string).length < 2 || (value as string).length > 100) return 'Nome do admin deve ter entre 2 e 100 caracteres';
        return null;
      case 'adminPassword':
        if (value && (value as string).length > 0 && (value as string).length < 8) return 'Senha deve ter pelo menos 8 caracteres';
        if (value && (value as string).length > 128) return 'Senha deve ter no máximo 128 caracteres';
        return null;
      case 'domain':
        if (value && (value as string).trim() !== '' && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value as string)) return 'Domínio inválido';
        return null;
      default:
        return null;
    }
  };

  const handleChange = (name: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    const error = validateField(name, value);
    setErrors(prev => ({ ...prev, [name]: error || '' }));
  };

  const handleSmtpChange = (field: keyof SmtpConfigInput, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      smtpConfig: { ...prev.smtpConfig, [field]: value } as SmtpConfigInput,
    }));
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    let hasErrors = false;

    Object.keys(formData).forEach(key => {
      if (key !== 'smtpConfig' && key !== 'repo' && key !== 'branch' && key !== 'dockerfilePath' && key !== 'publicApiUrl') {
        const error = validateField(key, formData[key as keyof CreateDeploymentInput]);
        if (error) {
          newErrors[key] = error;
          hasErrors = true;
        }
      }
    });

    if (!formData.adminPassword || formData.adminPassword.length < 8) {
      newErrors.adminPassword = 'Senha do admin é obrigatória (mínimo 8 caracteres)';
      hasErrors = true;
    }

    if (smtpEnabled) {
      const smtpFields: (keyof SmtpConfigInput)[] = ['host', 'port', 'user', 'pass', 'from'];
      smtpFields.forEach(field => {
        const value = formData.smtpConfig?.[field];
        if (!value || (typeof value === 'string' && value.trim() === '') || (typeof value === 'number' && value <= 0)) {
          newErrors[`smtp.${field}`] = `SMTP ${field} é obrigatório`;
          hasErrors = true;
        }
      });
      if (formData.smtpConfig?.from && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.smtpConfig.from)) {
        newErrors['smtp.from'] = 'SMTP from deve ser um email válido';
        hasErrors = true;
      }
    }

    setErrors(newErrors);
    return !hasErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      showToast('error', 'Por favor, corrija os erros no formulário');
      return;
    }

    setLoading(true);

    try {
      // Prepare data for API (exclude frontend-only fields)
      const { smtpConfig, repo, branch, dockerfilePath, publicApiUrl, ...deploymentData } = formData;

      const apiPayload: CreateDeploymentInput = {
        ...deploymentData,
        repo,
        branch,
        dockerfilePath,
        publicApiUrl: publicApiUrl || undefined,
        smtpConfig: smtpEnabled ? smtpConfig : undefined,
      };

      const result = await api.createDeployment(apiPayload);
      showToast('success', `Deployment ${result.slug} criado com sucesso`);
      navigate(`/deployments/${result.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao criar deployment';
      showToast('error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleSlugChange = (value: string) => {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    handleChange('slug', sanitized);

    // Auto-generate domain and publicApiUrl if not manually set
    if (!formData.domain || formData.domain === `${formData.slug}.apollofit.com.br`) {
      handleChange('domain', `${sanitized}.apollofit.com.br`);
    }
    if (!formData.publicApiUrl || formData.publicApiUrl === `https://api.${formData.slug}.apollofit.com.br`) {
      handleChange('publicApiUrl', `https://api.${sanitized}.apollofit.com.br`);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Nova Instalação</h1>
        <p className="page-description">Configure e inicie o provisionamento de uma nova filial Apollo Fit</p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <h2 className="card-title">Informações da Filial</h2>
          </CardHeader>
          <CardContent>
            <div className="form-row">
              <Input
                label="Slug"
                value={formData.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="ex: filial-sp"
                error={errors.slug}
                help="Identificador único (letras minúsculas, números e hífens). Usado no subdomínio."
                required
                autoComplete="off"
              />
              <Input
                label="Nome"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="ex: Filial São Paulo"
                error={errors.name}
                required
              />
            </div>

            <div className="form-row">
              <Input
                label="Email do Admin"
                type="email"
                value={formData.adminEmail}
                onChange={(e) => handleChange('adminEmail', e.target.value)}
                placeholder="admin@filial.apollofit.com.br"
                error={errors.adminEmail}
                required
                autoComplete="email"
              />
              <Input
                label="Nome do Admin"
                value={formData.adminName}
                onChange={(e) => handleChange('adminName', e.target.value)}
                placeholder="Administrador da Filial"
                error={errors.adminName}
                required
                autoComplete="name"
              />
            </div>

            <div className="form-row">
              <Input
                label="Senha do Admin"
                type="password"
                value={formData.adminPassword}
                onChange={(e) => handleChange('adminPassword', e.target.value)}
                placeholder="Mínimo 8 caracteres"
                error={errors.adminPassword}
                help="Usada para criar o usuário administrador da filial. Fica armazenada criptografada."
                required
                autoComplete="new-password"
              />
              <Input
                label="Domínio Personalizado (opcional)"
                value={formData.domain}
                onChange={(e) => handleChange('domain', e.target.value)}
                placeholder="filial.empresa.com.br"
                error={errors.domain}
                help="Se não informado, será usado: slug.apollofit.com.br"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <input
                  type="checkbox"
                  checked={formData.customDomain}
                  onChange={(e) => handleChange('customDomain', e.target.checked)}
                  style={{ marginRight: 'var(--spacing-sm)' }}
                />
                Usar domínio personalizado (configurar DNS manualmente)
              </label>
            </div>
          </CardContent>
        </Card>

        <Card style={{ marginTop: 'var(--spacing-lg)' }}>
          <CardHeader>
            <h2 className="card-title">Configurações de Pagamento (Mercado Pago)</h2>
          </CardHeader>
          <CardContent>
            <div className="form-group">
              <label className="form-label">
                <input
                  type="checkbox"
                  checked={formData.mercadoPagoEnabled}
                  onChange={(e) => handleChange('mercadoPagoEnabled', e.target.checked)}
                  style={{ marginRight: 'var(--spacing-sm)' }}
                />
                Habilitar Mercado Pago
              </label>
            </div>
            {formData.mercadoPagoEnabled && (
              <Select
                label="Modo"
                value={formData.mercadoPagoMode}
                onChange={(e) => handleChange('mercadoPagoMode', e.target.value)}
                options={MERCADO_PAGO_MODES as any}
                placeholder="Selecione o modo"
              />
            )}
          </CardContent>
        </Card>

        <Card style={{ marginTop: 'var(--spacing-lg)' }}>
          <CardHeader>
            <h2 className="card-title">Configurações SMTP (Opcional)</h2>
          </CardHeader>
          <CardContent>
            <div className="form-group">
              <label className="form-label">
                <input
                  type="checkbox"
                  checked={smtpEnabled}
                  onChange={(e) => setSmtpEnabled(e.target.checked)}
                  style={{ marginRight: 'var(--spacing-sm)' }}
                />
                Configurar SMTP personalizado
              </label>
            </div>
            {smtpEnabled && (
              <>
                <div className="form-row">
                  <Input
                    label="Host SMTP"
                    value={formData.smtpConfig?.host || ''}
                    onChange={(e) => handleSmtpChange('host', e.target.value)}
                    placeholder="smtp.exemplo.com"
                    error={errors['smtp.host']}
                    required
                  />
                  <Input
                    label="Porta"
                    type="number"
                    value={formData.smtpConfig?.port || ''}
                    onChange={(e) => handleSmtpChange('port', parseInt(e.target.value) || 0)}
                    placeholder="587"
                    error={errors['smtp.port']}
                    required
                  />
                </div>
                <div className="form-row">
                  <Input
                    label="Usuário"
                    value={formData.smtpConfig?.user || ''}
                    onChange={(e) => handleSmtpChange('user', e.target.value)}
                    placeholder="usuario@exemplo.com"
                    error={errors['smtp.user']}
                    required
                    autoComplete="username"
                  />
                  <Input
                    label="Senha"
                    type="password"
                    value={formData.smtpConfig?.pass || ''}
                    onChange={(e) => handleSmtpChange('pass', e.target.value)}
                    placeholder="••••••••"
                    error={errors['smtp.pass']}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <Input
                  label="Email Remetente (From)"
                  type="email"
                  value={formData.smtpConfig?.from || ''}
                  onChange={(e) => handleSmtpChange('from', e.target.value)}
                  placeholder="noreply@filial.apollofit.com.br"
                  error={errors['smtp.from']}
                  required
                  autoComplete="email"
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card style={{ marginTop: 'var(--spacing-lg)' }}>
          <CardHeader>
            <h2 className="card-title">Configurações Operacionais</h2>
          </CardHeader>
          <CardContent>
            <p className="form-help" style={{ marginBottom: 'var(--spacing-md)' }}>
              Estes valores são usados durante o provisionamento. Geralmente não precisam ser alterados.
            </p>
            <div className="form-row">
              <Input
                label="Repositório"
                value={formData.repo}
                onChange={(e) => handleChange('repo', e.target.value)}
                placeholder="apollofitweb/apollo-web"
              />
              <Input
                label="Branch"
                value={formData.branch}
                onChange={(e) => handleChange('branch', e.target.value)}
                placeholder="develop"
              />
            </div>
            <div className="form-row">
              <Input
                label="Caminho do Dockerfile"
                value={formData.dockerfilePath}
                onChange={(e) => handleChange('dockerfilePath', e.target.value)}
                placeholder="docker/Dockerfile"
              />
              <Input
                label="URL da API Pública"
                value={formData.publicApiUrl}
                onChange={(e) => handleChange('publicApiUrl', e.target.value)}
                placeholder="https://api.filial.apollofit.com.br"
              />
            </div>
          </CardContent>
        </Card>

        <div className="form-actions" style={{ marginTop: 'var(--spacing-xl)' }}>
          <Button type="button" variant="secondary" onClick={() => navigate('/')}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={loading} size="lg">
            {loading ? 'Criando...' : 'Criar Instalação'}
          </Button>
        </div>
      </form>
    </div>
  );
}