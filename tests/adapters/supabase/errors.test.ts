/**
 * Unit tests for Supabase error classes and mapping
 */

import { describe, it, expect } from 'vitest';
import {
  SupabaseApiError,
  SupabaseAuthError,
  SupabaseForbiddenError,
  SupabaseNotFoundError,
  SupabaseRateLimitError,
  SupabaseServerError,
  SupabaseNetworkError,
  SupabaseTimeoutError,
  mapHttpError,
  toAdapterError,
} from '../../../src/adapters/supabase/errors.js';

describe('Supabase Error Classes', () => {
  describe('SupabaseApiError', () => {
    it('should create error with all properties', () => {
      const error = new SupabaseApiError(400, '/projects/ref', 'GET', 'Bad request', { detail: 'invalid' });
      expect(error.statusCode).toBe(400);
      expect(error.endpoint).toBe('/projects/ref');
      expect(error.method).toBe('GET');
      expect(error.message).toBe('Bad request');
      expect(error.details).toEqual({ detail: 'invalid' });
      expect(error.name).toBe('SupabaseApiError');
    });
  });

  describe('SupabaseAuthError', () => {
    it('should create 401 error with default message', () => {
      const error = new SupabaseAuthError('/projects/ref', 'GET');
      expect(error.statusCode).toBe(401);
      expect(error.message).toContain('Falha de autenticação');
    });
  });

  describe('SupabaseForbiddenError', () => {
    it('should create 403 error with default message', () => {
      const error = new SupabaseForbiddenError('/projects/ref', 'POST');
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('Acesso negado');
    });
  });

  describe('SupabaseNotFoundError', () => {
    it('should create 404 error with default message', () => {
      const error = new SupabaseNotFoundError('/projects/ref', 'GET');
      expect(error.statusCode).toBe(404);
      expect(error.message).toContain('não encontrado');
    });
  });

  describe('SupabaseRateLimitError', () => {
    it('should create 429 error with retry-after', () => {
      const error = new SupabaseRateLimitError('/projects/ref', 'GET', 120);
      expect(error.statusCode).toBe(429);
      expect(error.retryAfterSeconds).toBe(120);
      expect(error.message).toContain('120');
    });

    it('should create 429 error without retry-after', () => {
      const error = new SupabaseRateLimitError('/projects/ref', 'GET', undefined);
      expect(error.retryAfterSeconds).toBeUndefined();
      expect(error.message).toContain('alguns');
    });
  });

  describe('SupabaseServerError', () => {
    it('should create 5xx error with status code', () => {
      const error = new SupabaseServerError('/projects/ref', 'GET', 502);
      expect(error.statusCode).toBe(502);
      expect(error.message).toContain('502');
    });
  });

  describe('SupabaseNetworkError', () => {
    it('should wrap original error', () => {
      const original = new Error('Connection refused');
      const error = new SupabaseNetworkError('/projects/ref', 'GET', original);
      expect(error.message).toContain('Connection refused');
      expect(error.cause).toBe(original);
    });
  });

  describe('SupabaseTimeoutError', () => {
    it('should include timeout value in message', () => {
      const error = new SupabaseTimeoutError('/projects/ref', 'POST', 10000);
      expect(error.timeoutMs).toBe(10000);
      expect(error.message).toContain('10000');
    });
  });
});

describe('mapHttpError', () => {
  it('should map 400 to SupabaseApiError', () => {
    const error = mapHttpError(400, '/projects/ref', 'POST', { message: 'bad' });
    expect(error).toBeInstanceOf(SupabaseApiError);
    expect(error.statusCode).toBe(400);
  });

  it('should map 401 to SupabaseAuthError', () => {
    const error = mapHttpError(401, '/projects/ref', 'GET');
    expect(error).toBeInstanceOf(SupabaseAuthError);
  });

  it('should map 403 to SupabaseForbiddenError', () => {
    const error = mapHttpError(403, '/projects/ref', 'GET');
    expect(error).toBeInstanceOf(SupabaseForbiddenError);
  });

  it('should map 404 to SupabaseNotFoundError', () => {
    const error = mapHttpError(404, '/projects/ref', 'GET');
    expect(error).toBeInstanceOf(SupabaseNotFoundError);
  });

  it('should map 429 to SupabaseRateLimitError with Retry-After', () => {
    const error = mapHttpError(429, '/projects/ref', 'GET', null, '45');
    expect(error).toBeInstanceOf(SupabaseRateLimitError);
    expect((error as SupabaseRateLimitError).retryAfterSeconds).toBe(45);
  });

  it('should map 429 to SupabaseRateLimitError without Retry-After', () => {
    const error = mapHttpError(429, '/projects/ref', 'GET', null, null);
    expect(error).toBeInstanceOf(SupabaseRateLimitError);
    expect((error as SupabaseRateLimitError).retryAfterSeconds).toBeUndefined();
  });

  it('should map 500 to SupabaseServerError', () => {
    const error = mapHttpError(500, '/projects/ref', 'GET');
    expect(error).toBeInstanceOf(SupabaseServerError);
    expect(error.statusCode).toBe(500);
  });

  it('should map 502 to SupabaseServerError', () => {
    const error = mapHttpError(502, '/projects/ref', 'GET');
    expect(error).toBeInstanceOf(SupabaseServerError);
    expect(error.statusCode).toBe(502);
  });

  it('should map 503 to SupabaseServerError', () => {
    const error = mapHttpError(503, '/projects/ref', 'GET');
    expect(error).toBeInstanceOf(SupabaseServerError);
    expect(error.statusCode).toBe(503);
  });

  it('should map 504 to SupabaseServerError', () => {
    const error = mapHttpError(504, '/projects/ref', 'GET');
    expect(error).toBeInstanceOf(SupabaseServerError);
    expect(error.statusCode).toBe(504);
  });

  it('should map unknown status to generic SupabaseApiError', () => {
    const error = mapHttpError(418, '/projects/ref', 'GET');
    expect(error).toBeInstanceOf(SupabaseApiError);
    expect(error.statusCode).toBe(418);
  });
});

describe('toAdapterError', () => {
  it('should convert SupabaseAuthError to adapter result', () => {
    const error = new SupabaseAuthError('/projects/ref', 'GET');
    const result = toAdapterError(error);
    expect(result).toEqual({ success: false, error: 'Falha de autenticação com Supabase: verifique o Personal Access Token' });
  });

  it('should convert SupabaseForbiddenError to adapter result', () => {
    const error = new SupabaseForbiddenError('/projects/ref', 'GET');
    const result = toAdapterError(error);
    expect(result).toEqual({ success: false, error: 'Token sem permissão para esta operação no Supabase' });
  });

  it('should convert SupabaseNotFoundError to adapter result', () => {
    const error = new SupabaseNotFoundError('/projects/ref', 'GET');
    const result = toAdapterError(error);
    expect(result).toEqual({ success: false, error: 'Projeto ou recurso não encontrado no Supabase' });
  });

  it('should convert SupabaseRateLimitError to adapter result with retry info', () => {
    const error = new SupabaseRateLimitError('/projects/ref', 'GET', 30);
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Rate limit excedido no Supabase');
    expect(result.error).toContain('30');
  });

  it('should convert SupabaseServerError to adapter result', () => {
    const error = new SupabaseServerError('/projects/ref', 'GET', 500);
    const result = toAdapterError(error);
    expect(result).toEqual({ success: false, error: 'Erro no servidor Supabase (500). Tente novamente mais tarde' });
  });

  it('should convert SupabaseNetworkError to adapter result', () => {
    const error = new SupabaseNetworkError('/projects/ref', 'GET', new Error('network'));
    const result = toAdapterError(error);
    expect(result).toEqual({ success: false, error: 'Falha de conexão com Supabase Management API' });
  });

  it('should convert SupabaseTimeoutError to adapter result', () => {
    const error = new SupabaseTimeoutError('/projects/ref', 'GET', 10000);
    const result = toAdapterError(error);
    expect(result).toEqual({ success: false, error: 'Timeout ao conectar com Supabase (10000ms)' });
  });

  it('should convert generic SupabaseApiError to adapter result', () => {
    const error = new SupabaseApiError(400, '/projects/ref', 'GET', 'Bad request');
    const result = toAdapterError(error);
    expect(result).toEqual({ success: false, error: 'Erro da Supabase Management API (400)' });
  });

  it('should convert unknown Error to generic adapter result', () => {
    const error = new Error('Something went wrong');
    const result = toAdapterError(error);
    expect(result).toEqual({ success: false, error: 'Erro inesperado ao comunicar com Supabase' });
  });
});