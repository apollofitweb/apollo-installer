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

// Custom error classes for migration lifecycle
export class MigrationExecutionError extends Error {
  constructor(public readonly migrationName: string, cause: Error) {
    super(`Migration ${migrationName} execution failed: ${cause.message}`);
    this.name = 'MigrationExecutionError';
  }
}

export class MigrationRegistrationError extends Error {
  constructor(public readonly migrationName: string, public readonly phase: 'started' | 'finished', cause: Error) {
    super(`Migration ${migrationName} registration (${phase}) failed: ${cause.message}`);
    this.name = 'MigrationRegistrationError';
  }
}

export class MigrationChecksumMismatchError extends Error {
  constructor(public readonly migrationName: string, public readonly existingChecksum: string, public readonly calculatedChecksum: string) {
    super(`Migration ${migrationName} checksum mismatch: existing=${existingChecksum}, calculated=${calculatedChecksum}`);
    this.name = 'MigrationChecksumMismatchError';
  }
}

export class MigrationInProgressOrOrphanedError extends Error {
  constructor(public readonly migrationName: string, public readonly existingRecord: { id: string; checksum: string; started_at: string; finished_at: string | null; rolled_back_at: string | null }) {
    super(`Migration ${migrationName} has uncertain state: started_at=${existingRecord.started_at}, finished_at=${existingRecord.finished_at}, rolled_back_at=${existingRecord.rolled_back_at}`);
    this.name = 'MigrationInProgressOrOrphanedError';
  }
}

export class MigrationTimeoutUnknownStateError extends Error {
  constructor(public readonly migrationName: string, message: string) {
    super(`Migration ${migrationName} timeout: ${message}`);
    this.name = 'MigrationTimeoutUnknownStateError';
  }
}

export class MigrationInvalidStateError extends Error {
  constructor(public readonly migrationName: string, public readonly existingRecord: unknown) {
    super(`Migration ${migrationName} has invalid state: ${JSON.stringify(existingRecord)}`);
    this.name = 'MigrationInvalidStateError';
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
  // Custom migration errors - preserve their detailed messages
  if (error instanceof MigrationExecutionError) {
    return { success: false, error: error.message };
  }
  if (error instanceof MigrationRegistrationError) {
    return { success: false, error: error.message };
  }
  if (error instanceof MigrationChecksumMismatchError) {
    return { success: false, error: error.message };
  }
  if (error instanceof MigrationInProgressOrOrphanedError) {
    return { success: false, error: error.message };
  }
  if (error instanceof MigrationTimeoutUnknownStateError) {
    return { success: false, error: error.message };
  }
  if (error instanceof MigrationInvalidStateError) {
    return { success: false, error: error.message };
  }

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