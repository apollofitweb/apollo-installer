import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No data" description="There is nothing here" />);
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('There is nothing here')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    const icon = <svg data-testid="icon" width="24" height="24" />;
    render(<EmptyState title="No data" description="Desc" icon={icon} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders action when provided', () => {
    render(
      <EmptyState
        title="No data"
        description="Desc"
        action={<button data-testid="action">Action</button>}
      />
    );
    expect(screen.getByTestId('action')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<EmptyState title="No data" description="Desc" className="custom-empty" />);
    expect(screen.getByText('No data').closest('.empty-state')).toHaveClass('custom-empty');
  });

  it('applies large size class', () => {
    render(<EmptyState title="No data" description="Desc" className="empty-state-lg" />);
    expect(screen.getByText('No data').closest('.empty-state')).toHaveClass('empty-state-lg');
  });
});