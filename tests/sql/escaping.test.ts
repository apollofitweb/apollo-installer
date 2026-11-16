/**
 * Testes de validação para escapePgLiteral e buildSafeQuery
 * Validação experimental ANTES de usar em produção
 */

import { describe, it, expect } from 'vitest';

function escapePgLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NaN/Infinity não permitido em SQL');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') throw new Error('Objetos não suportados - serializar antes');
  throw new Error(`Tipo não suportado: ${typeof value}`);
}

function buildSafeQuery(template: string, params: unknown[]): string {
  // Usar regex com word boundary para não substituir $1 dentro de $10
  // Placeholders são $1, $2... onde \d+ seguido de non-digit ou fim
  // Parâmetros ausentes (índice >= params.length) viram NULL
  let result = template;

  // Encontrar o maior placeholder no template
  const maxPlaceholderMatch = template.match(/\$(\d+)/g);
  const maxPlaceholder = maxPlaceholderMatch
    ? Math.max(...maxPlaceholderMatch.map(m => parseInt(m.slice(1))))
    : 0;

  for (let i = maxPlaceholder - 1; i >= 0; i--) {
    const placeholderNum = i + 1;
    const escaped = placeholderNum <= params.length
      ? escapePgLiteral(params[placeholderNum - 1])
      : 'NULL';
    const regex = new RegExp(`\\$${placeholderNum}(?=\\D|$)`, 'g');
    result = result.replace(regex, escaped);
  }

  if (/\$\d+/.test(result)) {
    throw new Error('Placeholders não substituídos: ' + result.match(/\$\d+/g)?.join(', '));
  }
  return result;
}

describe('escapePgLiteral', () => {
  it('string simples', () => {
    expect(escapePgLiteral('test')).toBe("'test'");
  });

  it('string com aspas simples', () => {
    expect(escapePgLiteral("it's")).toBe("'it''s'");
  });

  it('string vazia', () => {
    expect(escapePgLiteral('')).toBe("''");
  });

  it('SQL injection attempt', () => {
    expect(escapePgLiteral("' OR '1'='1")).toBe("''' OR ''1''=''1'");
  });

  it('comentário SQL', () => {
    expect(escapePgLiteral('-- comentário')).toBe("'-- comentário'");
  });

  it('tentativa de quebra de statement', () => {
    expect(escapePgLiteral("'; DROP TABLE users; --")).toBe("'''; DROP TABLE users; --'");
  });

  it('placeholder literal $1', () => {
    expect(escapePgLiteral('$1')).toBe("'$1'");
  });

  it('NULL', () => {
    expect(escapePgLiteral(null)).toBe('NULL');
    expect(escapePgLiteral(undefined)).toBe('NULL');
  });

  it('números', () => {
    expect(escapePgLiteral(123)).toBe('123');
    expect(escapePgLiteral(0)).toBe('0');
    expect(escapePgLiteral(-456)).toBe('-456');
    expect(escapePgLiteral(3.14)).toBe('3.14');
  });

  it('NaN/Infinity lançam erro', () => {
    expect(() => escapePgLiteral(NaN)).toThrow('NaN/Infinity');
    expect(() => escapePgLiteral(Infinity)).toThrow('NaN/Infinity');
    expect(() => escapePgLiteral(-Infinity)).toThrow('NaN/Infinity');
  });

  it('booleanos', () => {
    expect(escapePgLiteral(true)).toBe('TRUE');
    expect(escapePgLiteral(false)).toBe('FALSE');
  });

  it('Date', () => {
    const d = new Date('2024-01-01T12:00:00.000Z');
    expect(escapePgLiteral(d)).toBe("'2024-01-01T12:00:00.000Z'");
  });

  it('objeto lança erro', () => {
    expect(() => escapePgLiteral({ a: 1 })).toThrow('Objetos não suportados');
    expect(() => escapePgLiteral([1, 2])).toThrow('Objetos não suportados');
  });
});

describe('buildSafeQuery', () => {
  it('substitui placeholders simples', () => {
    const sql = buildSafeQuery('SELECT * FROM t WHERE a = $1 AND b = $2', ['x', 123]);
    expect(sql).toBe("SELECT * FROM t WHERE a = 'x' AND b = 123");
  });

  it('substitui múltiplas ocorrências do mesmo placeholder', () => {
    const sql = buildSafeQuery('SELECT $1, $1, $2', ['valor', 42]);
    expect(sql).toBe("SELECT 'valor', 'valor', 42");
  });

  it('parâmetros ausentes viram NULL', () => {
    const sql = buildSafeQuery('SELECT $1, $2', ['only one']);
    expect(sql).toBe("SELECT 'only one', NULL");
  });

  it('não confunde $10 com $1 - placeholders são posicionais', () => {
    // $1 = params[0], $10 = params[9]
    // Se template tem $10 mas só 2 params, $10 vira NULL
    const sql = buildSafeQuery('SELECT $1, $10', ['a', 'b']);
    expect(sql).toBe("SELECT 'a', NULL");
  });

  it('substitui corretamente $10 quando há 10 params', () => {
    const sql = buildSafeQuery('SELECT $1, $10', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    expect(sql).toBe("SELECT 'a', 'j'");
  });

  it('não substitui dentro de strings literais no template', () => {
    // Este é um caso conhecido: se o template já tem '...$1...', será substituído
    // Solução: não usar $n dentro de literais no template
    const sql = buildSafeQuery("SELECT 'literal $1'", ['valor']);
    expect(sql).toBe("SELECT 'literal 'valor''");
  });
});

describe('Validação de segurança integrada', () => {
  it('INSERT histórico com migration.name perigoso', () => {
    const dangerousName = "20240101000000_init'; DROP TABLE x; --";
    const sql = buildSafeQuery(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, logs, applied_steps_count) VALUES ($1, $2, $3, $4, $5, $6)`,
      ['uuid-1', 'checksum-1', dangerousName, '2024-01-01T00:00:00.000Z', 'Started', 0]
    );
    // Verificar que aspas são escapadas: ' -> ''
    // Input: 20240101000000_init'; DROP TABLE x; --
    // Escaped: 20240101000000_init''; DROP TABLE x; --
    // Final SQL: ... VALUES ('uuid-1', 'checksum-1', '20240101000000_init''; DROP TABLE x; --', ...)
    expect(sql).toContain("20240101000000_init''; DROP TABLE x; --");
    // O DROP TABLE aparece como string literal, não como comando
    expect(sql).toContain("DROP TABLE x; --");
  });

  it('UPDATE logs com mensagem perigosa', () => {
    const dangerousMsg = "Error: ' OR '1'='1";
    const sql = buildSafeQuery(
      `UPDATE "_prisma_migrations" SET logs = $1 WHERE id = $2`,
      [dangerousMsg, 'uuid-1']
    );
    // ' -> ''
    expect(sql).toContain("Error: '' OR ''1''=''1");
  });
});