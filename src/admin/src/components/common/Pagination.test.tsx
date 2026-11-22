import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('renders pagination controls', () => {
    render(<Pagination currentPage={1} totalPages={5} totalItems={50} onPageChange={vi.fn()} itemsPerPage={10} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('shows current page', () => {
    render(<Pagination currentPage={3} totalPages={5} totalItems={50} onPageChange={vi.fn()} itemsPerPage={10} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls onPageChange when page button clicked', () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={1} totalPages={5} totalItems={50} onPageChange={onPageChange} itemsPerPage={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Página 2' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables previous button on first page', () => {
    render(<Pagination currentPage={1} totalPages={5} totalItems={50} onPageChange={vi.fn()} itemsPerPage={10} />);
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(<Pagination currentPage={5} totalPages={5} totalItems={50} onPageChange={vi.fn()} itemsPerPage={10} />);
    expect(screen.getByRole('button', { name: /próxima/i })).toBeDisabled();
  });

  it('shows total items', () => {
    render(<Pagination currentPage={1} totalPages={5} totalItems={50} onPageChange={vi.fn()} itemsPerPage={10} />);
    expect(screen.getByText(/de 50/)).toBeInTheDocument();
  });

  it('does not render when totalPages is 1', () => {
    render(<Pagination currentPage={1} totalPages={1} totalItems={5} onPageChange={vi.fn()} itemsPerPage={10} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});