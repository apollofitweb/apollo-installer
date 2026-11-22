import { DEPLOYMENT_STEPS } from '../../types';
import { getStepStatusLabel } from '../../lib/utils';

interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
  steps?: Array<{
    stepNumber: number;
    name: string;
    status: string;
    errorMessage: string | null;
  }>;
}

export function StepProgress({ currentStep, steps = [] }: StepProgressProps) {
  const stepDefinitions = DEPLOYMENT_STEPS;

  return (
    <div className="step-progress" role="list" aria-label="Progresso do deployment">
      {stepDefinitions.map((stepDef) => {
        const stepNumber = stepDef.stepNumber;
        const step = steps.find((s) => s.stepNumber === stepNumber);
        const stepStatus = step?.status || 'PENDING';
        const isActive = stepNumber === currentStep && stepStatus === 'RUNNING';
        const isCompleted = stepStatus === 'COMPLETED';
        const isFailed = stepStatus === 'FAILED';

        let itemClass = '';
        if (isActive) itemClass = 'active';
        else if (isCompleted) itemClass = 'completed';
        else if (isFailed) itemClass = 'failed';

        return (
          <div key={stepNumber} className={`step-item ${itemClass}`} role="listitem">
            <div className="step-circle" aria-label={`Passo ${stepNumber}: ${getStepStatusLabel(stepStatus)}`}>
              {isCompleted ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : isFailed ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                stepNumber
              )}
            </div>
            <span className="step-label">{stepDef.name.replace(/_/g, ' ')}</span>
            {step && step.errorMessage && isFailed && (
              <span className="form-error" style={{ fontSize: '0.65rem', maxWidth: '200px', textAlign: 'center' }}>
                {step.errorMessage}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}