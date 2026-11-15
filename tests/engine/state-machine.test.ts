/**
 * Tests for deployment state machine
 */

import { describe, it, expect } from 'vitest';
import {
  canTransitionDeployment,
  assertDeploymentTransition,
  canTransitionStep,
  assertStepTransition,
  isTerminalDeploymentStatus,
  isTerminalStepStatus,
  isFailedStatus,
  getNextDeploymentStatus,
  getNextStepStatus,
} from '../../src/engine/state-machine.js';

describe('State Machine - Deployment Transitions', () => {
  it('should allow PENDING -> VALIDATING', () => {
    expect(canTransitionDeployment('PENDING', 'VALIDATING')).toBe(true);
  });

  it('should allow PENDING -> FAILED', () => {
    expect(canTransitionDeployment('PENDING', 'FAILED')).toBe(true);
  });

  it('should not allow PENDING -> IN_PROGRESS directly', () => {
    expect(canTransitionDeployment('PENDING', 'IN_PROGRESS')).toBe(false);
  });

  it('should allow VALIDATING -> IN_PROGRESS', () => {
    expect(canTransitionDeployment('VALIDATING', 'IN_PROGRESS')).toBe(true);
  });

  it('should allow IN_PROGRESS -> WAITING_EXTERNAL', () => {
    expect(canTransitionDeployment('IN_PROGRESS', 'WAITING_EXTERNAL')).toBe(true);
  });

  it('should allow IN_PROGRESS -> COMPLETED', () => {
    expect(canTransitionDeployment('IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('should allow IN_PROGRESS -> FAILED', () => {
    expect(canTransitionDeployment('IN_PROGRESS', 'FAILED')).toBe(true);
  });

  it('should allow WAITING_EXTERNAL -> IN_PROGRESS', () => {
    expect(canTransitionDeployment('WAITING_EXTERNAL', 'IN_PROGRESS')).toBe(true);
  });

  it('should allow FAILED -> VALIDATING (retry)', () => {
    expect(canTransitionDeployment('FAILED', 'VALIDATING')).toBe(true);
  });

  it('should allow COMPLETED -> ROLLED_BACK', () => {
    expect(canTransitionDeployment('COMPLETED', 'ROLLED_BACK')).toBe(true);
  });

  it('should not allow COMPLETED -> IN_PROGRESS', () => {
    expect(canTransitionDeployment('COMPLETED', 'IN_PROGRESS')).toBe(false);
  });

  it('should not allow invalid transitions', () => {
    expect(canTransitionDeployment('VALIDATING', 'PENDING')).toBe(false);
    expect(canTransitionDeployment('IN_PROGRESS', 'VALIDATING')).toBe(false);
    expect(canTransitionDeployment('COMPLETED', 'FAILED')).toBe(false);
  });
});

describe('State Machine - Step Transitions', () => {
  it('should allow PENDING -> RUNNING', () => {
    expect(canTransitionStep('PENDING', 'RUNNING')).toBe(true);
  });

  it('should allow PENDING -> SKIPPED', () => {
    expect(canTransitionStep('PENDING', 'SKIPPED')).toBe(true);
  });

  it('should allow RUNNING -> COMPLETED', () => {
    expect(canTransitionStep('RUNNING', 'COMPLETED')).toBe(true);
  });

  it('should allow RUNNING -> FAILED', () => {
    expect(canTransitionStep('RUNNING', 'FAILED')).toBe(true);
  });

  it('should allow FAILED -> RUNNING (retry)', () => {
    expect(canTransitionStep('FAILED', 'RUNNING')).toBe(true);
  });

  it('should not allow COMPLETED -> any', () => {
    expect(canTransitionStep('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransitionStep('COMPLETED', 'PENDING')).toBe(false);
  });

  it('should not allow SKIPPED -> any', () => {
    expect(canTransitionStep('SKIPPED', 'RUNNING')).toBe(false);
    expect(canTransitionStep('SKIPPED', 'PENDING')).toBe(false);
  });
});

describe('State Machine - Terminal States', () => {
  it('should identify COMPLETED as terminal', () => {
    expect(isTerminalDeploymentStatus('COMPLETED')).toBe(true);
  });

  it('should identify ROLLED_BACK as terminal', () => {
    expect(isTerminalDeploymentStatus('ROLLED_BACK')).toBe(true);
  });

  it('should not identify IN_PROGRESS as terminal', () => {
    expect(isTerminalDeploymentStatus('IN_PROGRESS')).toBe(false);
  });

  it('should identify COMPLETED step as terminal', () => {
    expect(isTerminalStepStatus('COMPLETED')).toBe(true);
  });

  it('should identify SKIPPED step as terminal', () => {
    expect(isTerminalStepStatus('SKIPPED')).toBe(true);
  });

  it('should not identify RUNNING step as terminal', () => {
    expect(isTerminalStepStatus('RUNNING')).toBe(false);
  });
});

describe('State Machine - Failed Status', () => {
  it('should identify FAILED deployment as failed', () => {
    expect(isFailedStatus('FAILED')).toBe(true);
  });

  it('should identify FAILED step as failed', () => {
    expect(isFailedStatus('FAILED')).toBe(true);
  });

  it('should not identify COMPLETED as failed', () => {
    expect(isFailedStatus('COMPLETED')).toBe(false);
  });
});

describe('State Machine - Next Status Helpers', () => {
  it('should return valid next statuses for PENDING', () => {
    const next = getNextDeploymentStatus('PENDING');
    expect(next).toContain('VALIDATING');
    expect(next).toContain('FAILED');
  });

  it('should return valid next statuses for IN_PROGRESS', () => {
    const next = getNextDeploymentStatus('IN_PROGRESS');
    expect(next).toContain('WAITING_EXTERNAL');
    expect(next).toContain('COMPLETED');
    expect(next).toContain('FAILED');
  });

  it('should return valid next statuses for PENDING step', () => {
    const next = getNextStepStatus('PENDING');
    expect(next).toContain('RUNNING');
    expect(next).toContain('SKIPPED');
  });
});

describe('State Machine - Assert Functions', () => {
  it('should throw on invalid deployment transition', () => {
    expect(() => assertDeploymentTransition('PENDING', 'IN_PROGRESS')).toThrow('Invalid deployment transition');
  });

  it('should not throw on valid deployment transition', () => {
    expect(() => assertDeploymentTransition('PENDING', 'VALIDATING')).not.toThrow();
  });

  it('should throw on invalid step transition', () => {
    expect(() => assertStepTransition('RUNNING', 'PENDING')).toThrow('Invalid step transition');
  });

  it('should not throw on valid step transition', () => {
    expect(() => assertStepTransition('PENDING', 'RUNNING')).not.toThrow();
  });
});