import { ReactNode, HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Card({ children, className = '', style, ...props }: CardProps) {
  return <div className={`card ${className}`} style={style} {...props}>{children}</div>;
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function CardHeader({ children, className = '', style, ...props }: CardHeaderProps) {
  return <div className={`card-header ${className}`} style={style} {...props}>{children}</div>;
}

interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function CardContent({ children, className = '', style, ...props }: CardContentProps) {
  return <div className={`card-content ${className}`} style={style} {...props}>{children}</div>;
}