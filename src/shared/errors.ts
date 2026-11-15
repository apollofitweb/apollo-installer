/**
 * Custom errors for Apollo Installer
 */

export class InstallerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'InstallerError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends InstallerError {
  constructor(message: string, public readonly field: string, public readonly value?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, { field, value });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends InstallerError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404, { resource, id });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends InstallerError {
  constructor(message: string, public readonly field: string, public readonly value?: unknown) {
    super(message, 'CONFLICT', 409, { field, value });
    this.name = 'ConflictError';
  }
}

export class AdapterError extends InstallerError {
  constructor(
    message: string,
    public readonly adapter: string,
    public readonly originalError?: Error
  ) {
    super(message, 'ADAPTER_ERROR', 502, { adapter, originalError: originalError?.message });
    this.name = 'AdapterError';
  }
}

export class DeploymentError extends InstallerError {
  constructor(
    message: string,
    public readonly deploymentId: string,
    public readonly stepNumber: number,
    public readonly originalError?: Error
  ) {
    super(message, 'DEPLOYMENT_ERROR', 500, { deploymentId, stepNumber, originalError: originalError?.message });
    this.name = 'DeploymentError';
  }
}

export class StateTransitionError extends InstallerError {
  constructor(
    message: string,
    public readonly currentState: string,
    public readonly targetState: string
  ) {
    super(message, 'INVALID_STATE_TRANSITION', 400, { currentState, targetState });
    this.name = 'StateTransitionError';
  }
}

export class DeploymentVersionConflictError extends InstallerError {
  constructor(
    public readonly entity: 'Deployment' | 'DeploymentStep',
    public readonly id: string,
    public readonly expectedVersion: number,
    public readonly currentVersion: number
  ) {
    super(
      `${entity} version conflict for ${id}: expected ${expectedVersion}, current ${currentVersion}`,
      'VERSION_CONFLICT',
      409,
      { entity, id, expectedVersion, currentVersion }
    );
    this.name = 'DeploymentVersionConflictError';
  }
}