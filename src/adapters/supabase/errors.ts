/**
 * Supabase Management API Error Handling
 * Maps HTTP errors to structured AdapterResult errors
 */

export class SupabaseApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly endpoint: string,
    public readonly method: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SupabaseApiError';
  }
}

export class SupabaseAuthError extends SupabaseApiError {
  constructor(endpoint: string, method: string, details?: unknown) {
    super(401, endpoint, method, 'Falha de autenticação com Supabase Management API: PAT inválido ou expirado', details);
    this.name = 'SupabaseAuthError';
  }
}

export class SupabaseForbiddenError extends SupabaseApiError {
  constructor(endpoint: string, method: string, details?: unknown) {
    super(403, endpoint, method, 'Acesso negado: PAT sem permissão para esta operação', details);
    this.name = 'SupabaseForbiddenError';
  }
}

export class SupabaseNotFoundError extends SupabaseApiError {
  constructor(endpoint: string, method: string, details?: unknown) {
    super(404, endpoint, method, 'Recurso não encontrado na Supabase Management API', details);
    this.name = 'SupabaseNotFoundError';
  }
}

export class SupabaseRateLimitError extends SupabaseApiError {
  constructor(
    endpoint: string,
    method: string,
    public readonly retryAfterSeconds?: number,
    details?: unknown
  ) {
    super(429, endpoint, method, `Rate limit excedido. Tente novamente em ${retryAfterSeconds ?? 'alguns'} segundos`, details);
    this.name = 'SupabaseRateLimitError';
  }
}

export class SupabaseServerError extends SupabaseApiError {
  constructor(endpoint: string, method: string, statusCode: number, details?: unknown) {
    super(statusCode, endpoint, method, `Erro no servidor Supabase (${statusCode})`, details);
    this.name = 'SupabaseServerError';
  }
}

export class SupabaseNetworkError extends Error {
  constructor(public readonly endpoint: string, public readonly method: string, originalError: Error) {
    super(`Falha de rede ao chamar Supabase Management API: ${originalError.message}`);
    this.name = 'SupabaseNetworkError';
    this.cause = originalError;
  }
}

export class SupabaseTimeoutError extends Error {
  constructor(public readonly endpoint: string, public readonly method: string, public readonly timeoutMs: number) {
    super(`Timeout (${timeoutMs}ms) ao chamar Supabase Management API: ${method} ${endpoint}`);
    this.name = 'SupabaseTimeoutError';
  }
}

export function mapHttpError(
  statusCode: number,
  endpoint: string,
  method: string,
  body?: unknown,
  retryAfterHeader?: string | null
): SupabaseApiError {
  switch (statusCode) {
    case 400:
      return new SupabaseApiError(400, endpoint, method, 'Requisição inválida para Supabase Management API', body);
    case 401:
      return new SupabaseAuthError(endpoint, method, body);
    case 403:
      return new SupabaseForbiddenError(endpoint, method, body);
    case 404:
      return new SupabaseNotFoundError(endpoint, method, body);
    case 429: {
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      return new SupabaseRateLimitError(endpoint, method, isNaN(retryAfter as number) ? undefined : retryAfter, body);
    }
    case 500:
    case 502:
    case 503:
    case 504:
      return new SupabaseServerError(endpoint, method, statusCode, body);
    default:
      return new SupabaseApiError(statusCode, endpoint, method, `Erro HTTP ${statusCode} da Supabase Management API`, body);
  }
}

export function toAdapterError(error: Error): { success: false; error: string } {
  if (error instanceof SupabaseAuthError) {
    return { success: false, error: 'Falha de autenticação com Supabase: verifique o Personal Access Token' };
  }
  if (error instanceof SupabaseForbiddenError) {
    return { success: false, error: 'Token sem permissão para esta operação no Supabase' };
  }
  if (error instanceof SupabaseNotFoundError) {
    return { success: false, error: 'Projeto ou recurso não encontrado no Supabase' };
  }
  if (error instanceof SupabaseRateLimitError) {
    return { success: false, error: `Rate limit excedido no Supabase. Aguarde ${error.retryAfterSeconds ?? 'alguns segundos'} e tente novamente` };
  }
  if (error instanceof SupabaseServerError) {
    return { success: false, error: `Erro no servidor Supabase (${error.statusCode}). Tente novamente mais tarde` };
  }
  if (error instanceof SupabaseNetworkError) {
    return { success: false, error: 'Falha de conexão com Supabase Management API' };
  }
  if (error instanceof SupabaseTimeoutError) {
    return { success: false, error: `Timeout ao conectar com Supabase (${error.timeoutMs}ms)` };
  }
  if (error instanceof SupabaseApiError) {
    return { success: false, error: `Erro da Supabase Management API (${error.statusCode})` };
  }
  return { success: false, error: 'Erro inesperado ao comunicar com Supabase' };
}