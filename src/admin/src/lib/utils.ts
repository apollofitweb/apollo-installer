export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'agora mesmo';
  if (diffMins < 60) return `há ${diffMins} min`;
  if (diffHours < 24) return `há ${diffHours}h`;
  if (diffDays < 7) return `há ${diffDays}d`;
  return formatDate(dateString);
}

export function getStatusBadgeClass(status: string): string {
  return `badge-${status.toLowerCase()}`;
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Pendente',
    VALIDATING: 'Validando',
    IN_PROGRESS: 'Em Progresso',
    WAITING_EXTERNAL: 'Aguardando Externo',
    COMPLETED: 'Concluído',
    FAILED: 'Falhou',
    ROLLED_BACK: 'Revertido',
  };
  return labels[status] || status;
}

export function getStepStatusBadgeClass(status: string): string {
  return `badge-${status.toLowerCase().replace('_', '-')}`;
}

export function getStepStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Pendente',
    RUNNING: 'Executando',
    COMPLETED: 'Concluído',
    FAILED: 'Falhou',
    SKIPPED: 'Ignorado',
  };
  return labels[status] || status;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function maskSecret(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars * 2) {
    return '•'.repeat(value.length);
  }
  return value.slice(0, visibleChars) + '•'.repeat(value.length - visibleChars * 2) + value.slice(-visibleChars);
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}