import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Deployment, DeploymentStatus } from '../types';
import {
  Card, CardHeader, CardContent,
  Badge, Button, EmptyState, Pagination,
  StepProgress
} from '../components/common';
import { formatDate, formatRelativeTime, getStatusLabel, truncate } from '../lib/utils';
import { useToast } from '../lib/toast';

const STATUS_COLORS: Record<DeploymentStatus, 'pending' | 'validating' | 'in_progress' | 'waiting_external' | 'completed' | 'failed' | 'rolled_back'> = {
  PENDING: 'pending',
  VALIDATING: 'validating',
  IN_PROGRESS: 'in_progress',
  WAITING_EXTERNAL: 'waiting_external',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
};

export function Dashboard() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [refreshInterval, setRefreshInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const { showToast } = useToast();

  const fetchDeployments = useCallback(async () => {
    try {
      setError(null);
      const response = await api.getDeployments(page, 20);
      setDeployments(response.data);
      setTotalPages(response.pagination?.totalPages || 1);
      setTotalItems(response.pagination?.total || 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar deployments';
      setError(message);
      showToast('error', message);
    } finally {
      setLoading(false);
    }
  }, [page, showToast]);

  useEffect(() => {
    fetchDeployments();
  }, [fetchDeployments]);

  // Auto-refresh every 10 seconds for active deployments
  useEffect(() => {
    const hasActive = deployments.some(d =>
      d.status === 'IN_PROGRESS' || d.status === 'VALIDATING' || d.status === 'WAITING_EXTERNAL'
    );

    if (hasActive) {
      const interval = setInterval(fetchDeployments, 10000);
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    }

    if (refreshInterval) {
      clearInterval(refreshInterval);
      setRefreshInterval(null);
    }
  }, [deployments, fetchDeployments, refreshInterval]);

  const handleStartDeployment = async (deployment: Deployment) => {
    try {
      await api.startDeployment(deployment.id);
      showToast('success', `Deployment ${deployment.slug} iniciado`);
      fetchDeployments();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao iniciar deployment';
      showToast('error', message);
    }
  };

  const handleResumeDeployment = async (deployment: Deployment) => {
    try {
      await api.resumeDeployment(deployment.id);
      showToast('success', `Deployment ${deployment.slug} retomado`);
      fetchDeployments();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao retomar deployment';
      showToast('error', message);
    }
  };

  const handleDeleteDeployment = async (deployment: Deployment) => {
    if (!window.confirm(`Tem certeza que deseja excluir o deployment "${deployment.name}" (${deployment.slug})?`)) {
      return;
    }
    try {
      await api.deleteDeployment(deployment.id);
      showToast('success', `Deployment ${deployment.slug} excluído`);
      fetchDeployments();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao excluir deployment';
      showToast('error', message);
    }
  };

  const canStart = (status: DeploymentStatus) => status === 'PENDING' || status === 'FAILED';
  const canResume = (status: DeploymentStatus) => status === 'FAILED' || status === 'ROLLED_BACK';

  if (loading && deployments.length === 0) {
    return (
      <div className="card" style={{ minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--spacing-md)' }}>
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-description">Visão geral dos deployments de filiais</p>
          </div>
          <Link to="/deployments/new">
            <Button>Nova Instalação</Button>
          </Link>
        </div>
      </div>

      {error && deployments.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              icon={<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>}
              title="Erro ao carregar deployments"
              description={error}
              action={<Button onClick={fetchDeployments}>Tentar novamente</Button>}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-4" style={{ marginBottom: 'var(--spacing-xl)' }}>
        <Card>
          <CardContent>
            <div className="stat-value">{deployments.filter(d => d.status === 'COMPLETED').length}</div>
            <div className="stat-label">Concluídos</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="stat-value">{deployments.filter(d => d.status === 'IN_PROGRESS' || d.status === 'VALIDATING' || d.status === 'WAITING_EXTERNAL').length}</div>
            <div className="stat-label">Em Progresso</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="stat-value">{deployments.filter(d => d.status === 'FAILED').length}</div>
            <div className="stat-label">Falhou</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="stat-value">{deployments.filter(d => d.status === 'PENDING').length}</div>
            <div className="stat-label">Pendentes</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="card-title">Deployments Recentes</h2>
        </CardHeader>
        <CardContent>
          {deployments.length === 0 ? (
            <EmptyState
              icon={<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>}
              title="Nenhum deployment encontrado"
              description="Crie sua primeira instalação de filial clicando em 'Nova Instalação'"
              action={<Link to="/deployments/new"><Button>Nova Instalação</Button></Link>}
            />
          ) : (
            <>
              <div className="table-container">
                <table className="table" role="table">
                  <thead>
                    <tr>
                      <th scope="col">Filial</th>
                      <th scope="col">Status</th>
                      <th scope="col">Progresso</th>
                      <th scope="col">Domínio</th>
                      <th scope="col">Última Atualização</th>
                      <th scope="col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.map((deployment) => (
                      <tr key={deployment.id}>
                        <td>
                          <div>
                            <strong>{deployment.name}</strong>
                            <br />
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                              {deployment.slug}
                            </span>
                          </div>
                        </td>
                        <td>
                          <Badge variant={STATUS_COLORS[deployment.status]}>
                            {getStatusLabel(deployment.status)}
                          </Badge>
                        </td>
                        <td>
                          <StepProgress
                            currentStep={deployment.currentStep}
                            totalSteps={deployment.totalSteps}
                            steps={deployment.steps?.map(s => ({
                              stepNumber: s.stepNumber,
                              name: s.name,
                              status: s.status,
                              errorMessage: s.errorMessage,
                            }))}
                          />
                        </td>
                        <td>
                          {deployment.domain ? (
                            <a href={`https://${deployment.domain}`} target="_blank" rel="noopener noreferrer">
                              {truncate(deployment.domain, 35)}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span title={formatDate(deployment.updatedAt)}>
                            {formatRelativeTime(deployment.updatedAt)}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 'var(--spacing-xs)', flexWrap: 'wrap' }}>
                            <Link to={`/deployments/${deployment.id}`} style={{ textDecoration: 'none' }}>
                              <Button variant="ghost" size="sm">Ver</Button>
                            </Link>
                            {canStart(deployment.status) && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleStartDeployment(deployment)}
                              >
                                Iniciar
                              </Button>
                            )}
                            {canResume(deployment.status) && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleResumeDeployment(deployment)}
                              >
                                Retomar
                              </Button>
                            )}
                            {deployment.status === 'COMPLETED' && (
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleDeleteDeployment(deployment)}
                              >
                                Excluir
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={totalItems}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}