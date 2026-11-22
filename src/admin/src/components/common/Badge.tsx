import { ReactNode } from 'react';
import { classNames } from '../../lib/utils';

export interface BadgeProps {
  children: ReactNode;
  variant?: 'pending' | 'validating' | 'in_progress' | 'waiting_external' | 'completed' | 'failed' | 'rolled_back' | 'default';
  className?: string;
  style?: React.CSSProperties;
}

export function Badge({ children, variant = 'default', className = '', style }: BadgeProps) {
  return (
    <span className={classNames('badge', variant !== 'default' ? `badge-${variant}` : '', className)} style={style}>
      {children}
    </span>
  );
}