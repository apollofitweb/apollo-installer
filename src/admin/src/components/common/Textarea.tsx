import { TextareaHTMLAttributes, forwardRef } from 'react';
import { classNames } from '../../lib/utils';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  help?: string;
  required?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, help, required, className, id, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="form-group">
        {label && (
          <label htmlFor={textareaId} className="form-label">
            {label}
            {required && <span className="required" aria-hidden="true">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={classNames('form-input', error && 'form-input-error', className)}
          aria-invalid={!!error}
          aria-describedby={error ? `${textareaId}-error` : help ? `${textareaId}-help` : undefined}
          {...props}
        />
        {error && (
          <p id={`${textareaId}-error`} className="form-error" role="alert">
            {error}
          </p>
        )}
        {help && !error && (
          <p id={`${textareaId}-help`} className="form-help">
            {help}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';