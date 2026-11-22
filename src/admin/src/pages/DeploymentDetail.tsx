import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Deployment, DeploymentStatus } from '../types';
import {
  Card, CardHeader, CardContent,
  Badge, Button, StepProgress, Modal, EmptyState, Input
} from '../components/common';
import { formatDate, formatRelativeTime, getStatusLabel, getStatusBadgeClass } from '../lib/utils';
import { useToast } from '../lib/toast';
import { DEPLOYMENT_STEPS } from '../types';
import type { BadgeProps } from '../components/common/Badge';

const STATUS_COLORS: Record<DeploymentStatus, 'pending' | 'validating' | 'in_progress' | 'waiting_external' | 'completed' | 'failed' | 'rolled_back'> = {
  PENDING: 'pending',
  VALIDATING: 'validating',
  IN_PROGRESS: 'in_progress',
  WAITING_EXTERNAL: 'waiting_external',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
};

export function DeploymentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});

  const fetchDeployment = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const data = await api.getDeployment(id);
      setDeployment(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar deployment';
      setError(message);
      showToast('error', message);
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    fetchDeployment();
  }, [fetchDeployment]);

  // Auto-refresh for active deployments
  useEffect(() => {
    if (!deployment) return;

    const isActive = deployment.status === 'IN_PROGRESS' ||
                     deployment.status === 'VALIDATING' ||
                     deployment.status === 'WAITING_EXTERNAL';

    if (isActive) {
      const interval = setInterval(fetchDeployment, 5000);
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    }

    if (refreshInterval) {
      clearInterval(refreshInterval);
      setRefreshInterval(null);
    }
  }, [deployment, fetchDeployment, refreshInterval]);

  const handleAction = async (action: 'start' | 'resume' | 'delete') => {
    if (!deployment) return;

    setActionLoading(action);
    try {
      if (action === 'start') {
        await api.startDeployment(deployment.id);
        showToast('success', `Deployment ${deployment.slug} iniciado`);
      } else if (action === 'resume') {
        await api.resumeDeployment(deployment.id);
        showToast('success', `Deployment ${deployment.slug} retomado`);
      } else if (action === 'delete') {
        await api.deleteDeployment(deployment.id);
        showToast('success', `Deployment ${deployment.slug} excluído`);
        navigate('/');
        return;
      }
      fetchDeployment();
    } catch (err) {
      const message = err instanceof Error ? err.message : `Erro ao ${action === 'delete' ? 'excluir' : action === 'start' ? 'iniciar' : 'retomar'} deployment`;
      showToast('error', message);
    } finally {
      setActionLoading(null);
    }
  };

  const openConfigModal = () => {
    if (!deployment) return;
    const config = deployment.config;
    setConfigForm({
      supabaseRegion: config?.supabaseRegion ?? '',
      supabaseProjectRef: config?.supabaseProjectRef ?? '',
      renderServiceId: config?.renderServiceId ?? '',
      netlifySiteId: config?.netlifySiteId ?? '',
      allowedOrigins: config?.allowedOrigins ?? '',
      repo: config?.repo ?? '',
      branch: config?.branch ?? '',
      dockerfilePath: config?.dockerfilePath ?? '',
      publicApiUrl: config?.publicApiUrl ?? '',
    });
    setShowConfigModal(true);
  };

  const handleSaveConfig = async () => {
    if (!deployment) return;
    setConfigSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(configForm).filter(([, value]) => value.trim() !== '')
      );
      await api.updateDeploymentConfig(deployment.id, payload);
      showToast('success', 'Configuração salva');
      setShowConfigModal(false);
      fetchDeployment();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar configuração';
      showToast('error', message);
    } finally {
      setConfigSaving(false);
    }
  };

  const canStart = deployment?.status === 'PENDING' || deployment?.status === 'FAILED';
  const canResume = deployment?.status === 'FAILED' || deployment?.status === 'ROLLED_BACK';
  const canDelete = deployment?.status === 'COMPLETED' || deployment?.status === 'FAILED' || deployment?.status === 'ROLLED_BACK';

  if (loading && !deployment) {
    return (
      <div className="card" style={{ minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }} />
      </div>
    );
  }

  if (error && !deployment) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>}
            title="Erro ao carregar deployment"
            description={error}
            action={<Button onClick={fetchDeployment}>Tentar novamente</Button>}
          />
        </CardContent>
      </Card>
    );
  }

  if (!deployment) return null;

  const steps = deployment.steps || [];

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--spacing-md)' }}>
        <div>
          <nav style={{ marginBottom: 'var(--spacing-sm)' }} aria-label="Breadcrumb">
            <ol style={{ display: 'flex', gap: 'var(--spacing-sm)', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              <li><a href="/" style={{ color: 'var(--color-text-muted)' }}>Dashboard</a></li>
              <li aria-hidden="true">/</li>
              <li><a href="/deployments" style={{ color: 'var(--color-text-muted)' }}>Histórico</a></li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" style={{ color: 'var(--color-text)' }}>{deployment.name}</li>
            </ol>
          </nav>
          <h1 className="page-title">{deployment.name}</h1>
          <p className="page-description">
            <strong>{deployment.slug}</strong> •
            {deployment.domain && <a href={`https://${deployment.domain}`} target="_blank" rel="noopener noreferrer">{deployment.domain}</a>}
            {deployment.adminEmail && <span> • {deployment.adminEmail}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
          <Badge variant={STATUS_COLORS[deployment.status]} className="status-badge-lg">
            {getStatusLabel(deployment.status)}
          </Badge>
          {canStart && (
            <Button
              variant="primary"
              onClick={() => handleAction('start')}
              loading={actionLoading === 'start'}
              disabled={actionLoading !== null}
            >
              Iniciar
            </Button>
          )}
          {canResume && (
            <Button
              variant="secondary"
              onClick={() => handleAction('resume')}
              loading={actionLoading === 'resume'}
              disabled={actionLoading !== null}
            >
              Retomar
            </Button>
          )}
          {canDelete && (
            <Button
              variant="danger"
              onClick={() => setShowDeleteConfirm(true)}
              loading={actionLoading === 'delete'}
              disabled={actionLoading !== null}
            >
              Excluir
            </Button>
          )}
          <Button variant="secondary" onClick={openConfigModal} disabled={actionLoading !== null}>
            Configurar
          </Button>
          <Button variant="ghost" onClick={() => navigate('/')}>
            Voltar
          </Button>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 'var(--spacing-xl)' }}>
        <Card>
          <CardHeader>
            <h2 className="card-title">Progresso do Deployment</h2>
          </CardHeader>
          <CardContent>
            <StepProgress
              currentStep={deployment.currentStep}
              totalSteps={deployment.totalSteps}
              steps={steps.map(s => ({
                stepNumber: s.stepNumber,
                name: s.name,
                status: s.status,
                errorMessage: s.errorMessage,
              }))}
            />
            <div style={{ marginTop: 'var(--spacing-lg)', padding: 'var(--spacing-md)', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--spacing-xs)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Passo Atual</span>
                <strong>{deployment.currentStep} / {deployment.totalSteps}</strong>
              </div>
              {steps.length > 0 && steps[deployment.currentStep - 1] && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Status do Passo</span>
                  <Badge variant={getStatusBadgeClass(steps[deployment.currentStep - 1].status) as BadgeProps['variant']}>
                    {getStatusLabel(steps[deployment.currentStep - 1].status)}
                  </Badge>
                </div>
              )}
              {deployment.errorMessage && (
                <div style={{ marginTop: 'var(--spacing-md)', padding: 'var(--spacing-md)', background: 'var(--color-danger)', color: 'white', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
                  <strong>Erro: </strong>{deployment.errorMessage}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="card-title">Informações</h2>
          </CardHeader>
          <CardContent>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--spacing-sm) var(--spacing-lg)', fontSize: '0.875rem' }}>
              <dt style={{ color: 'var(--color-text-muted)' }}>ID</dt>
              <dd style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{deployment.id}</dd>

              <dt style={{ color: 'var(--color-text-muted)' }}>Slug</dt>
              <dd>{deployment.slug}</dd>

              <dt style={{ color: 'var(--color-text-muted)' }}>Domínio</dt>
              <dd>{deployment.domain ? <a href={`https://${deployment.domain}`} target="_blank" rel="noopener noreferrer">{deployment.domain}</a> : '—'}</dd>

              <dt style={{ color: 'var(--color-text-muted)' }}>Admin</dt>
              <dd>{deployment.adminName} {'<'} {deployment.adminEmail} {'>'}</dd>

              <dt style={{ color: 'var(--color-text-muted)' }}>Criado em</dt>
              <dd><time dateTime={deployment.createdAt}>{formatDate(deployment.createdAt)}</time></dd>

              <dt style={{ color: 'var(--color-text-muted)' }}>Atualizado em</dt>
              <dd><time dateTime={deployment.updatedAt}>{formatDate(deployment.updatedAt)}</time></dd>

              {deployment.completedAt && (
                <>
                  <dt style={{ color: 'var(--color-text-muted)' }}>Concluído em</dt>
                  <dd><time dateTime={deployment.completedAt}>{formatDate(deployment.completedAt)}</time></dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="card-title">Detalhes dos Passos</h2>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <EmptyState
              title="Nenhum passo executado"
              description="Os passos aparecerão aqui conforme o deployment avança"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
              {DEPLOYMENT_STEPS.map((stepDef) => {
                const step = steps.find(s => s.stepNumber === stepDef.stepNumber);
                const stepStatus = step?.status || 'PENDING';
                const isActive = stepDef.stepNumber === deployment.currentStep && stepStatus === 'RUNNING';
                const isCompleted = stepStatus === 'COMPLETED';
                const isFailed = stepStatus === 'FAILED';

                return (
                  <div
                    key={stepDef.stepNumber}
                    className="card"
                    style={{
                      borderLeft: `4px solid ${
                        isActive ? 'var(--color-primary)' :
                        isCompleted ? 'var(--color-success)' :
                        isFailed ? 'var(--color-danger)' :
                        'var(--color-border)'
                      }`
                    }}
                  >
                    <div className="card-content" style={{ padding: 'var(--spacing-md)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap', marginBottom: 'var(--spacing-sm)' }}>
                        <Badge variant={getStatusBadgeClass(stepStatus) as BadgeProps['variant']}>
                          {getStatusLabel(stepStatus)}
                        </Badge>
                        <strong>{stepDef.name.replace(/_/g, ' ')}</strong>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                          Passo {stepDef.stepNumber} de {DEPLOYMENT_STEPS.length}
                        </span>
                        {step?.startedAt && (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                            Iniciado: {formatRelativeTime(step.startedAt)}
                          </span>
                        )}
                        {step?.completedAt && (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                            Concluído: {formatRelativeTime(step.completedAt)}
                          </span>
                        )}
                      </div>
                      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: 'var(--spacing-sm)' }}>
                        {stepDef.description}
                      </p>

                      {step?.errorMessage && (
                        <div style={{
                          padding: 'var(--spacing-sm) var(--spacing-md)',
                          background: 'var(--color-danger)',
                          color: 'white',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '0.8125rem',
                          fontFamily: 'var(--font-mono)'
                        }}>
                          {step.errorMessage}
                        </div>
                      )}

                      {step?.metadata && Object.keys(step.metadata).length > 0 && (
                        <details style={{ marginTop: 'var(--spacing-sm)' }}>
                          <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                            Ver metadados do passo
                          </summary>
                          <pre style={{
                            marginTop: 'var(--spacing-sm)',
                            padding: 'var(--spacing-sm)',
                            background: 'var(--color-bg)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '0.75rem',
                            overflow: 'auto',
                            maxHeight: '200px'
                          }}>
                            {JSON.stringify(step.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {deployment.config && (
        <Card style={{ marginTop: 'var(--spacing-lg)' }}>
          <CardHeader>
            <h2 className="card-title">Configuração Operacional</h2>
          </CardHeader>
          <CardContent>
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-sm) var(--spacing-lg)', fontSize: '0.875rem' }}>
              {Object.entries(deployment.config).map(([key, value]) => {
                if (value == null) return null;
                const text = String(value);
                const isUrl = typeof value === 'string' && /^https?:\/\//i.test(value);
                return (
                  <Fragment key={key}>
                    <dt style={{ color: 'var(--color-text-muted)' }}>{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</dt>
                    <dd style={{ fontFamily: isUrl ? 'unset' : 'var(--font-mono)', wordBreak: 'break-all' }}>
                      {isUrl ? <a href={text} target="_blank" rel="noopener noreferrer">{text}</a> : text}
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      )}

      <Modal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        title="Configuração Operacional"
        size="md"
      >
        <p className="form-help" style={{ marginBottom: 'var(--spacing-md)' }}>
          Região, IDs de serviço e demais dados usados pelo provisionamento.
          Preencha os campos obrigatórios antes de iniciar.
        </p>
        <div className="form-row">
          <Input
            label="Região Supabase"
            value={configForm.supabaseRegion ?? ''}
            onChange={(e) => setConfigForm({ ...configForm, supabaseRegion: e.target.value })}
            placeholder="sa-east-1"
          />
          <Input
            label="Project Ref Supabase (opcional)"
            value={configForm.supabaseProjectRef ?? ''}
            onChange={(e) => setConfigForm({ ...configForm, supabaseProjectRef: e.target.value })}
            placeholder="20 caracteres"
          />
        </div>
        <div className="form-row">
          <Input
            label="ID do Serviço Render"
            value={configForm.renderServiceId ?? ''}
            onChange={(e) => setConfigForm({ ...configForm, renderServiceId: e.target.value })}
            placeholder="srv-..."
          />
          <Input
            label="ID do Site Netlify"
            value={configForm.netlifySiteId ?? ''}
            onChange={(e) => setConfigForm({ ...configForm, netlifySiteId: e.target.value })}
            placeholder="site id compartilhado"
          />
        </div>
        <Input
          label="Origens Permitidas (CORS)"
          value={configForm.allowedOrigins ?? ''}
          onChange={(e) => setConfigForm({ ...configForm, allowedOrigins: e.target.value })}
          placeholder="https://filial.apollofit.com.br"
        />
        <div className="form-row">
          <Input
            label="Repositório"
            value={configForm.repo ?? ''}
            onChange={(e) => setConfigForm({ ...configForm, repo: e.target.value })}
          />
          <Input
            label="Branch"
            value={configForm.branch ?? ''}
            onChange={(e) => setConfigForm({ ...configForm, branch: e.target.value })}
          />
        </div>
        <div className="form-row">
          <Input
            label="Dockerfile"
            value={configForm.dockerfilePath ?? ''}
            onChange={(e) => setConfigForm({ ...configForm, dockerfilePath: e.target.value })}
          />
          <Input
            label="URL da API Pública"
            value={configForm.publicApiUrl ?? ''}
            onChange={(e) => setConfigForm({ ...configForm, publicApiUrl: e.target.value })}
            placeholder="https://api.filial.apollofit.com.br"
          />
        </div>
        <div className="modal-footer">
          <Button variant="secondary" onClick={() => setShowConfigModal(false)} disabled={configSaving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSaveConfig} loading={configSaving}>
            Salvar
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Confirmar Exclusão"
        size="sm"
      >
        <p>Tem certeza que deseja excluir o deployment <strong>{deployment.name}</strong> ({deployment.slug})?</p>
        <p className="form-help">Esta ação não pode ser desfeita.</p>
        <div className="modal-footer">
          <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>Cancelar</Button>
          <Button variant="danger" onClick={() => handleAction('delete')} loading={actionLoading === 'delete'}>Excluir</Button>
        </div>
      </Modal>
    </div>
  );
}