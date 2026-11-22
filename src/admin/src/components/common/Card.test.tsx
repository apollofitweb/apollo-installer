import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardContent } from './Card';

describe('Card', () => {
  it('renders children correctly', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<Card className="custom-class">Content</Card>);
    expect(screen.getByText('Content')).toHaveClass('custom-class');
  });

  it('applies custom style', () => {
    render(<Card style={{ backgroundColor: 'red' }}>Content</Card>);
    expect((screen.getByText('Content') as HTMLElement).style.backgroundColor).toBe('red');
  });
});

describe('CardHeader', () => {
  it('renders children correctly', () => {
    render(<CardHeader>Header content</CardHeader>);
    expect(screen.getByText('Header content')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<CardHeader className="header-custom">Content</CardHeader>);
    expect(screen.getByText('Content')).toHaveClass('header-custom');
  });
});

describe('CardContent', () => {
  it('renders children correctly', () => {
    render(<CardContent>Content here</CardContent>);
    expect(screen.getByText('Content here')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<CardContent className="content-custom">Content</CardContent>);
    expect(screen.getByText('Content')).toHaveClass('content-custom');
  });
});