/**
 * Input validation for Apollo Installer
 * Uses Zod for schema validation
 */

import { z } from 'zod';
import type { ValidationResult, ValidationErrorDetail } from '../shared/types.js';

const slugSchema = z
  .string()
  .min(2, 'Slug deve ter pelo menos 2 caracteres')
  .max(50, 'Slug deve ter no máximo 50 caracteres')
  .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens')
  .refine((s) => !s.startsWith('-') && !s.endsWith('-'), 'Slug não pode começar ou terminar com hífen');

const emailSchema = z
  .string()
  .email('E-mail inválido')
  .max(255, 'E-mail muito longo');

const domainSchema = z
  .string()
  .max(255, 'Domínio muito longo')
  .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, 'Domínio inválido')
  .optional();

export const filialInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(100, 'Nome muito longo'),
  domain: domainSchema,
  adminEmail: emailSchema,
  adminName: z.string().min(2, 'Nome do admin deve ter pelo menos 2 caracteres').max(100, 'Nome muito longo'),
  adminPassword: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres').max(128).optional(),
  customDomain: z.boolean().optional(),
  mercadoPagoEnabled: z.boolean().optional(),
  mercadoPagoMode: z.enum(['sandbox', 'production']).optional(),
  smtpConfig: z
    .object({
      host: z.string().min(1, 'Host SMTP obrigatório'),
      port: z.number().int().min(1).max(65535, 'Porta inválida'),
      user: z.string().min(1, 'Usuário SMTP obrigatório'),
      pass: z.string().min(1, 'Senha SMTP obrigatória'),
      from: emailSchema,
    })
    .optional(),
});

export type FilialInputValidated = z.infer<typeof filialInputSchema>;

export function validateFilialInput(input: unknown): ValidationResult {
  const result = filialInputSchema.safeParse(input);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationErrorDetail[] = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));

  return { valid: false, errors };
}

export function validateSlugAvailability(slug: string, existingSlugs: string[]): ValidationResult {
  if (existingSlugs.includes(slug)) {
    return {
      valid: false,
      errors: [{ field: 'slug', message: 'Slug já está em uso', code: 'CONFLICT' }],
    };
  }
  return { valid: true, errors: [] };
}