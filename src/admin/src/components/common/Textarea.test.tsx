import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('renders with label', () => {
    render(<Textarea label="Description" id="desc" />);
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('renders placeholder', () => {
    render(<Textarea placeholder="Enter description" id="desc" />);
    expect(screen.getByPlaceholderText('Enter description')).toBeInTheDocument();
  });

  it('calls onChange handler', () => {
    const handleChange = vi.fn();
    render(<Textarea onChange={handleChange} id="desc" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Test description' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('shows error state', () => {
    render(<Textarea error="Required field" id="desc" />);
    expect(screen.getByText('Required field')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows help text', () => {
    render(<Textarea help="Enter a description" id="desc" />);
    expect(screen.getByText('Enter a description')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Textarea disabled id="desc" />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('applies rows attribute', () => {
    render(<Textarea rows={10} id="desc" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '10');
  });

  it('renders with value', () => {
    render(<Textarea value="Test value" id="desc" />);
    expect(screen.getByRole('textbox')).toHaveValue('Test value');
  });
});