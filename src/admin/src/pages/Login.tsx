import { useState, FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, Card, CardContent, Input } from '../components/common';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // O Render adormece após inatividade. Acorda a API enquanto o usuário digita,
  // evitando que o primeiro submit estoure o timeout do cold start.
  useEffect(() => {
    void api.healthCheck().catch(() => undefined);
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Informe e-mail e senha.');
      return;
    }

    setLoading(true);
    try {
      await api.login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--spacing-lg)' }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-lg)', justifyContent: 'center' }}>
          <div className="header-logo" aria-hidden="true">A</div>
          <div>
            <h1 className="page-title" style={{ marginBottom: 0 }}>Apollo Installer</h1>
            <p className="page-description" style={{ marginBottom: 0 }}>Acesso administrativo</p>
          </div>
        </div>

        <Card>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <Input
                label="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@apollofit.com.br"
                autoComplete="username"
                required
              />
              <Input
                label="Senha"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              {error && (
                <p className="form-error" role="alert" style={{ marginBottom: 'var(--spacing-md)' }}>
                  {error}
                </p>
              )}

              <Button type="submit" loading={loading} style={{ width: '100%' }}>
                Entrar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
