/**
 * State machine for deployment lifecycle
 * Ensures valid transitions between states
 */

import type { DeploymentStatus, StepStatus } from '../shared/types.js';
import { StateTransitionError } from '../shared/errors.js';

const DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  PENDING: ['VALIDATING', 'FAILED'],
  VALIDATING: ['IN_PROGRESS', 'FAILED'],
  IN_PROGRESS: ['WAITING_EXTERNAL', 'COMPLETED', 'FAILED'],
  WAITING_EXTERNAL: ['IN_PROGRESS', 'FAILED', 'COMPLETED'],
  COMPLETED: ['ROLLED_BACK'],
  FAILED: ['VALIDATING', 'ROLLED_BACK'],
  ROLLED_BACK: ['VALIDATING'],
};

const STEP_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  PENDING: ['RUNNING', 'SKIPPED'],
  RUNNING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['RUNNING'],
  SKIPPED: [],
};

export function canTransitionDeployment(current: DeploymentStatus, target: DeploymentStatus): boolean {
  return DEPLOYMENT_TRANSITIONS[current]?.includes(target) ?? false;
}

export function assertDeploymentTransition(current: DeploymentStatus, target: DeploymentStatus): void {
  if (!canTransitionDeployment(current, target)) {
    throw new StateTransitionError(
      `Invalid deployment transition from ${current} to ${target}`,
      current,
      target
    );
  }
}

export function canTransitionStep(current: StepStatus, target: StepStatus): boolean {
  return STEP_TRANSITIONS[current]?.includes(target) ?? false;
}

export function assertStepTransition(current: StepStatus, target: StepStatus): void {
  if (!canTransitionStep(current, target)) {
    throw new StateTransitionError(
      `Invalid step transition from ${current} to ${target}`,
      current,
      target
    );
  }
}

export function getNextDeploymentStatus(current: DeploymentStatus): DeploymentStatus[] {
  return DEPLOYMENT_TRANSITIONS[current] ?? [];
}

export function getNextStepStatus(current: StepStatus): StepStatus[] {
  return STEP_TRANSITIONS[current] ?? [];
}

export function isTerminalDeploymentStatus(status: DeploymentStatus): boolean {
  return status === 'COMPLETED' || status === 'ROLLED_BACK';
}

export function isTerminalStepStatus(status: StepStatus): boolean {
  return status === 'COMPLETED' || status === 'SKIPPED';
}

export function isFailedStatus(status: DeploymentStatus | StepStatus): boolean {
  return status === 'FAILED';
}