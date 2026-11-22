import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { Deployment, GlobalSecretKey, GLOBAL_SECRET_KEYS, DeploymentSecretMetadata, GlobalSecretMetadata } from '../types';
import {
  Card, CardHeader, CardContent,
  Button, Select, Modal, Badge, EmptyState, Textarea
} from '../components/common';
import { useToast } from '../lib/toast';

export function Credentials() {
  const { showToast } = useToast();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [_loadingDeployments, setLoadingDeployments] = useState(true);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [deploymentSecrets, setDeploymentSecrets] = useState<Record<string, DeploymentSecretMetadata>>({});
  const [globalSecrets, setGlobalSecrets] = useState<Record<string, GlobalSecretMetadata>>({});
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [modalMode, setModalMode] = useState<'deployment' | 'global'>('deployment');
  const [modalDeploymentId, setModalDeploymentId] = useState<string | null>(null);
  const [modalKey, setModalKey] = useState<string>('');
  const [modalValue, setModalValue] = useState('');
  const [modalExpectedVersion, setModalExpectedVersion] = useState(0);
  const [modalLoading, setModalLoading] = useState(false);

  const fetchDeployments = useCallback(async () => {
    try {
      const response = await api.getDeployments(1, 100);
      setDeployments(response.data);
    } catch (err) {
      showToast('error', 'Erro ao carregar filiais');
    } finally {
      setLoadingDeployments(false);
    }
  }, [showToast]);

  const fetchDeploymentSecrets = useCallback(async (deploymentId: string) => {
    setLoadingSecrets(true);
    try {
      const secrets = await api.listDeploymentSecrets(deploymentId);
      setDeploymentSecrets(secrets);
    } catch (err) {
      showToast('error', 'Erro ao carregar segredos da filial');
    } finally {
      setLoadingSecrets(false);
    }
  }, [showToast]);

  const fetchGlobalSecrets = useCallback(async () => {
    try {
      const secrets = await api.listGlobalSecrets();
      setGlobalSecrets(secrets);
    } catch (err) {
      showToast('error', 'Erro ao carregar segredos globais');
    }
  }, [showToast]);

  useEffect(() => {
    fetchDeployments();
  }, [fetchDeployments]);

  useEffect(() => {
    if (selectedDeploymentId) {
      fetchDeploymentSecrets(selectedDeploymentId);
    } else {
      setDeploymentSecrets({});
    }
  }, [selectedDeploymentId, fetchDeploymentSecrets]);

  useEffect(() => {
    fetchGlobalSecrets();
  }, [fetchGlobalSecrets]);

  const handleAddDeploymentSecret = (deploymentId: string, key: string) => {
    setModalMode('deployment');
    setModalDeploymentId(deploymentId);
    setModalKey(key);
    setModalValue('');
    setModalExpectedVersion(0);
    setShowSecretModal(true);
  };

  const handleAddGlobalSecret = (key: GlobalSecretKey) => {
    setModalMode('global');
    setModalDeploymentId(null);
    setModalKey(key);
    setModalValue('');
    setModalExpectedVersion(0);
    setShowSecretModal(true);
  };

  const handleEditSecret = (mode: 'deployment' | 'global', deploymentId: string | null, key: string, version: number) => {
    setModalMode(mode);
    setModalDeploymentId(deploymentId);
    setModalKey(key);
    setModalValue('');
    setModalExpectedVersion(version);
    setShowSecretModal(true);
  };

  const handleDeleteSecret = async (mode: 'deployment' | 'global', deploymentId: string | null, key: string, version: number) => {
    if (!window.confirm(`Tem certeza que deseja excluir o segredo "${key}"?`)) return;

    try {
      if (mode === 'deployment' && deploymentId) {
        await api.deleteDeploymentSecret(deploymentId, key, version);
        showToast('success', `Segredo ${key} excluído`);
        fetchDeploymentSecrets(deploymentId);
      } else {
        await api.deleteGlobalSecret(key as GlobalSecretKey, version);
        showToast('success', `Segredo global ${key} excluído`);
        fetchGlobalSecrets();
      }
    } catch (err) {
      showToast('error', 'Erro ao excluir segredo');
    }
  };

  const handleSaveSecret = async () => {
    if (!modalValue.trim()) {
      showToast('error', 'O valor do segredo não pode ser vazio');
      return;
    }

    setModalLoading(true);
    try {
      if (modalMode === 'deployment' && modalDeploymentId) {
        await api.setDeploymentSecret(modalDeploymentId, modalKey, modalValue, modalExpectedVersion);
        showToast('success', `Segredo ${modalKey} salvo`);
        fetchDeploymentSecrets(modalDeploymentId);
      } else {
        await api.setGlobalSecret(modalKey as GlobalSecretKey, modalValue, modalExpectedVersion);
        showToast('success', `Segredo global ${modalKey} salvo`);
        fetchGlobalSecrets();
      }
      setShowSecretModal(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar segredo';
      showToast('error', message);
    } finally {
      setModalLoading(false);
    }
  };

  const DEPLOYMENT_SECRET_KEYS = [
    'dbPassword',
    'jwtAccessSecret',
    'jwtRefreshSecret',
    'allowedOrigins',
  ] as const;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--spacing-md)' }}>
        <div>
          <h1 className="page-title">Gerenciamento de Credenciais</h1>
          <p className="page-description">Configure segredos para deployments e segredos globais compartilhados</p>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 'var(--spacing-lg)' }}>
        {/* Global Secrets */}
        <Card>
          <CardHeader>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--spacing-md)' }}>
              <h2 className="card-title">Segredos Globais</h2>
              <span className="badge badge-default" style={{ fontSize: '0.75rem' }}>{Object.keys(globalSecrets).length} / {GLOBAL_SECRET_KEYS.length}</span>
            </div>
          </CardHeader>
          <CardContent>
            {GLOBAL_SECRET_KEYS.map((key) => {
              const secret = globalSecrets[key];
              const exists = !!secret && !secret.deleted;

              return (
                <div key={key} className="card" style={{ marginBottom: 'var(--spacing-sm)' }}>
                  <div className="card-content" style={{ padding: 'var(--spacing-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--spacing-sm)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{key}</code>
                        {exists ? (
                          <Badge variant="completed">Configurado</Badge>
                        ) : (
                          <Badge variant="pending">Não configurado</Badge>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                        {exists && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => handleEditSecret('global', null, key, secret.version)}>
                              Editar
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => handleDeleteSecret('global', null, key, secret.version)}>
                              Excluir
                            </Button>
                          </>
                        )}
                        {!exists && (
                          <Button variant="primary" size="sm" onClick={() => handleAddGlobalSecret(key)}>
                            Adicionar
                          </Button>
                        )}
                      </div>
                    </div>
                    {exists && (
                      <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                        Versão: {secret.version} • Atualizado: {new Date(secret.updatedAt).toLocaleString('pt-BR')} • Por: {secret.updatedBy}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Deployment Secrets */}
        <Card>
          <CardHeader>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--spacing-md)' }}>
              <h2 className="card-title">Segredos por Filial</h2>
              <Select
                value={selectedDeploymentId || ''}
                onChange={(e) => setSelectedDeploymentId(e.target.value || null)}
                options={[{ value: '', label: 'Selecione uma filial...' }, ...deployments.map(d => ({ value: d.id, label: `${d.name} (${d.slug})` }))]}
                placeholder="Selecione uma filial"
                style={{ minWidth: '280px' }}
              />
            </div>
          </CardHeader>
          <CardContent>
            {loadingSecrets ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-xl)' }}>
                <div className="spinner" />
              </div>
            ) : !selectedDeploymentId ? (
              <EmptyState
                title="Selecione uma filial"
                description="Escolha uma filial no seletor acima para gerenciar seus segredos"
              />
            ) : deploymentSecrets && Object.keys(deploymentSecrets).length === 0 ? (
              <EmptyState
                title="Nenhum segredo configurado"
                description="Adicione os segredos necessários para o deployment desta filial"
              />
            ) : (
              <>
                {DEPLOYMENT_SECRET_KEYS.map((key) => {
                  const secret = deploymentSecrets[key];
                  const exists = !!secret && !secret.deleted;

                  return (
                    <div key={key} className="card" style={{ marginBottom: 'var(--spacing-sm)' }}>
                      <div className="card-content" style={{ padding: 'var(--spacing-md)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--spacing-sm)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{key}</code>
                            {exists ? (
                              <Badge variant="completed">Configurado</Badge>
                            ) : (
                              <Badge variant="pending">Não configurado</Badge>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                            {exists && (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => handleEditSecret('deployment', selectedDeploymentId!, key, secret.version)}>
                                  Editar
                                </Button>
                                <Button variant="danger" size="sm" onClick={() => handleDeleteSecret('deployment', selectedDeploymentId!, key, secret.version)}>
                                  Excluir
                                </Button>
                              </>
                            )}
                            {!exists && (
                              <Button variant="primary" size="sm" onClick={() => handleAddDeploymentSecret(selectedDeploymentId!, key)}>
                                Adicionar
                              </Button>
                            )}
                          </div>
                        </div>
                        {exists && (
                          <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                            Versão: {secret.version} • Atualizado: {new Date(secret.updatedAt).toLocaleString('pt-BR')} • Por: {secret.updatedBy}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Secret Modal */}
      <Modal
        isOpen={showSecretModal}
        onClose={() => setShowSecretModal(false)}
        title={modalExpectedVersion > 0 ? `Editar Segredo: ${modalKey}` : `Adicionar Segredo: ${modalKey}`}
        size="md"
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
            <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', padding: 'var(--spacing-xs) var(--spacing-sm)', borderRadius: 'var(--radius-sm)' }}>
              {modalKey}
            </code>
            <Badge variant={modalMode === 'global' ? 'completed' : 'validating'}>
              {modalMode === 'global' ? 'Global' : 'Deployment'}
            </Badge>
          </div>

          <Textarea
            label="Valor do Segredo"
            value={modalValue}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setModalValue(e.target.value)}
            placeholder="Cole ou digite o valor do segredo"
            rows={6}
            required
            help={modalExpectedVersion > 0 ? `Versão esperada: ${modalExpectedVersion} (optimistic locking)` : 'O valor será criptografado com AES-GCM antes de ser armazenado'}
          />

          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setShowSecretModal(false)} disabled={modalLoading}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleSaveSecret} loading={modalLoading} disabled={modalLoading}>
              {modalExpectedVersion > 0 ? 'Atualizar' : 'Salvar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}