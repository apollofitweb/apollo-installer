/**
 * Tests for shared types and validation
 */

import { describe, it, expect } from 'vitest';
import { validateFilialInput, validateSlugAvailability } from '../../src/config/validation.js';
import type { FilialInput } from '../../src/shared/types.js';

describe('Shared Types - Validation', () => {
  const validInput: FilialInput = {
    slug: 'bomfim',
    name: 'Academia Bom Fim',
    adminEmail: 'admin@bomfim.com',
    adminName: 'Administrador',
    domain: 'bomfim.apollofit.com.br',
    customDomain: true,
  };

  it('should validate correct input', () => {
    const result = validateFilialInput(validInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid slug format', () => {
    const invalid = { ...validInput, slug: 'Bom Fim' };
    const result = validateFilialInput(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'slug')).toBe(true);
  });

  it('should reject slug too short', () => {
    const invalid = { ...validInput, slug: 'a' };
    const result = validateFilialInput(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'slug')).toBe(true);
  });

  it('should reject slug too long', () => {
    const invalid = { ...validInput, slug: 'a'.repeat(51) };
    const result = validateFilialInput(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'slug')).toBe(true);
  });

  it('should reject invalid email', () => {
    const invalid = { ...validInput, adminEmail: 'not-an-email' };
    const result = validateFilialInput(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'adminEmail')).toBe(true);
  });

  it('should reject missing required fields', () => {
    const invalid = { ...validInput, adminName: '' };
    const result = validateFilialInput(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'adminName')).toBe(true);
  });

  it('should reject invalid domain format', () => {
    const invalid = { ...validInput, domain: 'not-a-domain' };
    const result = validateFilialInput(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'domain')).toBe(true);
  });

  it('should accept optional fields', () => {
    const withOptionals = {
      ...validInput,
      adminPassword: 'SecurePass123',
      mercadoPagoEnabled: true,
      mercadoPagoMode: 'sandbox' as const,
      smtpConfig: {
        host: 'smtp.example.com',
        port: 587,
        user: 'user',
        pass: 'pass',
        from: 'noreply@example.com',
      },
    };
    const result = validateFilialInput(withOptionals);
    expect(result.valid).toBe(true);
  });

  it('should reject weak admin password', () => {
    const invalid = { ...validInput, adminPassword: '123' };
    const result = validateFilialInput(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'adminPassword')).toBe(true);
  });

  it('should validate slug availability', () => {
    const existing = ['bomfim', 'centro', 'sul'];
    const result = validateSlugAvailability('bomfim', existing);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('CONFLICT');
  });

  it('should accept available slug', () => {
    const existing = ['bomfim', 'centro', 'sul'];
    const result = validateSlugAvailability('norte', existing);
    expect(result.valid).toBe(true);
  });
});