import { describe, it, expect, vi } from 'vitest';
import {
  formatDate,
  formatRelativeTime,
  getStatusLabel,
  getStepStatusLabel,
  truncate,
  maskSecret,
  generateId,
  debounce,
  classNames,
} from './utils';

describe('formatDate', () => {
  it('formats valid date string', () => {
    const localDate = new Date(2024, 0, 15, 10, 30);
    const result = formatDate(localDate.toISOString());
    expect(result).toMatch(/15\/01\/2024/);
    expect(result).toMatch(/10:30/);
  });

  it('returns dash for null', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('returns dash for invalid date', () => {
    expect(formatDate('invalid')).toBe('—');
  });
});

describe('formatRelativeTime', () => {
  it('returns "agora mesmo" for recent dates', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('agora mesmo');
  });

  it('returns minutes for < 1 hour', () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinsAgo)).toBe('há 5 min');
  });

  it('returns hours for < 24 hours', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe('há 2h');
  });

  it('returns days for < 7 days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('há 3d');
  });

  it('returns formatted date for > 7 days', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(tenDaysAgo);
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('returns dash for null', () => {
    expect(formatRelativeTime(null)).toBe('—');
  });
});

describe('getStatusLabel', () => {
  it('returns correct labels for all statuses', () => {
    expect(getStatusLabel('PENDING')).toBe('Pendente');
    expect(getStatusLabel('VALIDATING')).toBe('Validando');
    expect(getStatusLabel('IN_PROGRESS')).toBe('Em Progresso');
    expect(getStatusLabel('WAITING_EXTERNAL')).toBe('Aguardando Externo');
    expect(getStatusLabel('COMPLETED')).toBe('Concluído');
    expect(getStatusLabel('FAILED')).toBe('Falhou');
    expect(getStatusLabel('ROLLED_BACK')).toBe('Revertido');
  });

  it('returns status as-is for unknown', () => {
    expect(getStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('getStepStatusLabel', () => {
  it('returns correct labels for all step statuses', () => {
    expect(getStepStatusLabel('PENDING')).toBe('Pendente');
    expect(getStepStatusLabel('RUNNING')).toBe('Executando');
    expect(getStepStatusLabel('COMPLETED')).toBe('Concluído');
    expect(getStepStatusLabel('FAILED')).toBe('Falhou');
    expect(getStepStatusLabel('SKIPPED')).toBe('Ignorado');
  });

  it('returns status as-is for unknown', () => {
    expect(getStepStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('truncate', () => {
  it('returns original string if shorter than maxLength', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('truncates and adds ellipsis', () => {
    expect(truncate('very long string', 10)).toBe('very lo...');
  });

  it('handles exact length', () => {
    expect(truncate('exact', 5)).toBe('exact');
  });
});

describe('maskSecret', () => {
  it('masks entire string if very short', () => {
    expect(maskSecret('ab', 4)).toBe('••');
  });

  it('shows first and last chars for longer strings', () => {
    expect(maskSecret('abcdefgh', 2)).toBe('ab••••gh');
  });

  it('uses default visibleChars', () => {
    expect(maskSecret('abcdefghijkl')).toBe('abcd••••ijkl');
  });
});

describe('generateId', () => {
  it('generates a string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates different ids', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('debounce', () => {
  it('delays function execution', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 100));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments correctly', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced('arg1', 'arg2');
    await new Promise(r => setTimeout(r, 100));
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });
});

describe('classNames', () => {
  it('joins truthy classes', () => {
    expect(classNames('a', 'b', 'c')).toBe('a b c');
  });

  it('filters out falsy values', () => {
    expect(classNames('a', false, 'b', null, 'c', undefined, '' as any, '' as any)).toBe('a b c');
  });

  it('returns empty string for all falsy', () => {
    expect(classNames(false, null, undefined, '')).toBe('');
  });
});