import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Email" id="email" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders placeholder', () => {
    render(<Input placeholder="Enter email" id="email" />);
    expect(screen.getByPlaceholderText('Enter email')).toBeInTheDocument();
  });

  it('calls onChange handler', () => {
    const handleChange = vi.fn();
    render(<Input onChange={handleChange} id="email" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test@test.com' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('shows error state', () => {
    render(<Input error="Invalid email" id="email" />);
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows help text', () => {
    render(<Input help="Enter your email" id="email" />);
    expect(screen.getByText('Enter your email')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Input disabled id="email" />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('applies custom className', () => {
    render(<Input className="custom-input" id="email" />);
    expect(screen.getByRole('textbox')).toHaveClass('custom-input');
  });

  it('renders with value', () => {
    render(<Input value="test@test.com" id="email" />);
    expect(screen.getByRole('textbox')).toHaveValue('test@test.com');
  });
});