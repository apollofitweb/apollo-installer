import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Deployment, DeploymentStatus } from '../types';
import {
  Card, CardContent,
  Badge, Button, Select, Input, EmptyState, Pagination
} from '../components/common';
import { formatRelativeTime, getStatusLabel, truncate } from '../lib/utils';
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

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os Status' },
  { value: 'PENDING', label: 'Pendente' },
  { value: 'VALIDATING', label: 'Validando' },
  { value: 'IN_PROGRESS', label: 'Em Progresso' },
  { value: 'WAITING_EXTERNAL', label: 'Aguardando Externo' },
  { value: 'COMPLETED', label: 'Concluído' },
  { value: 'FAILED', label: 'Falhou' },
  { value: 'ROLLED_BACK', label: 'Revertido' },
];

export function DeploymentHistory() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { showToast } = useToast();

  const fetchDeployments = useCallback(async () => {
    try {
      // Note: API doesn't support filtering yet, we filter client-side
      const response = await api.getDeployments(page, 50);
      setDeployments(response.data);
      setTotalPages(response.pagination?.totalPages || 1);
      setTotalItems(response.pagination?.total || 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar deployments';
      showToast('error', message);
    } finally {
      setLoading(false);
    }
  }, [page, showToast]);

  useEffect(() => {
    fetchDeployments();
  }, [fetchDeployments]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredDeployments = useMemo(() => {
    return deployments.filter(deployment => {
      const matchesStatus = !statusFilter || deployment.status === statusFilter;
      const matchesSearch = !debouncedSearch ||
        deployment.slug.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        deployment.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        deployment.adminEmail.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (deployment.domain?.toLowerCase().includes(debouncedSearch.toLowerCase()) ?? false);
      return matchesStatus && matchesSearch;
    });
  }, [deployments, statusFilter, debouncedSearch]);

  const handleDelete = async (deployment: Deployment) => {
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

  const canDelete = (status: DeploymentStatus) =>
    status === 'COMPLETED' || status === 'FAILED' || status === 'ROLLED_BACK';

  if (loading && deployments.length === 0) {
    return (
      <div className="card" style={{ minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--spacing-md)' }}>
        <div>
          <h1 className="page-title">Histórico de Deployments</h1>
          <p className="page-description">Visualize e gerencie todos os deployments de filiais</p>
        </div>
        <Link to="/deployments/new">
          <Button>Nova Instalação</Button>
        </Link>
      </div>

      <Card>
        <CardContent style={{ padding: 'var(--spacing-md) var(--spacing-lg)' }}>
          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: '250px' }}>
              <label htmlFor="search" className="form-label">Buscar</label>
              <Input
                id="search"
                placeholder="Buscar por slug, nome, email ou domínio..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input"
              />
            </div>
            <Select
              label="Filtrar por Status"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              options={STATUS_OPTIONS as any}
              style={{ minWidth: '200px' }}
            />
          </div>
        </CardContent>
      </Card>

      <Card style={{ marginTop: 'var(--spacing-lg)' }}>
        <CardContent style={{ padding: 0 }}>
          {filteredDeployments.length === 0 ? (
            <EmptyState
              className="empty-state-lg"
              icon={<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>}
              title={debouncedSearch || statusFilter ? 'Nenhum deployment encontrado' : 'Nenhum deployment cadastrado'}
              description={debouncedSearch || statusFilter
                ? 'Tente ajustar os filtros de busca'
                : 'Crie sua primeira instalação de filial clicando em "Nova Instalação"'}
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
                      <th scope="col">Admin</th>
                      <th scope="col">Criado em</th>
                      <th scope="col">Atualizado em</th>
                      <th scope="col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeployments.map((deployment) => (
                      <tr key={deployment.id}>
                        <td>
                          <Link to={`/deployments/${deployment.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                            <strong>{deployment.name}</strong>
                            <br />
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                              {deployment.slug}
                            </span>
                          </Link>
                        </td>
                        <td>
                          <Badge variant={STATUS_COLORS[deployment.status]}>
                            {getStatusLabel(deployment.status)}
                          </Badge>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                            {deployment.currentStep} / {deployment.totalSteps}
                          </span>
                        </td>
                        <td>
                          {deployment.domain ? (
                            <a href={`https://${deployment.domain}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem' }}>
                              {truncate(deployment.domain, 35)}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>—</span>
                          )}
                        </td>
                        <td style={{ fontSize: '0.8125rem' }}>
                          {deployment.adminName} <br />
                          <span style={{ color: 'var(--color-text-muted)' }}>{deployment.adminEmail}</span>
                        </td>
                        <td style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                          <time dateTime={deployment.createdAt}>{formatRelativeTime(deployment.createdAt)}</time>
                        </td>
                        <td style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                          <time dateTime={deployment.updatedAt}>{formatRelativeTime(deployment.updatedAt)}</time>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 'var(--spacing-xs)', flexWrap: 'wrap' }}>
                            <Link to={`/deployments/${deployment.id}`} style={{ textDecoration: 'none' }}>
                              <Button variant="ghost" size="sm">Ver</Button>
                            </Link>
                            {canDelete(deployment.status) && (
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleDelete(deployment)}
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
              {totalPages > 1 && (
                <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  onPageChange={setPage}
                  itemsPerPage={50}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}