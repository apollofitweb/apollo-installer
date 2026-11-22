import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from './Select';

describe('Select', () => {
  const options = [
    { value: '', label: 'Select...' },
    { value: '1', label: 'Option 1' },
    { value: '2', label: 'Option 2' },
  ];

  it('renders with label', () => {
    render(<Select label="Choose" options={options} id="select" />);
    expect(screen.getByLabelText('Choose')).toBeInTheDocument();
  });

  it('renders options', () => {
    render(<Select options={options} id="select" />);
    expect(screen.getByRole('option', { name: 'Select...' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument();
  });

  it('calls onChange handler', () => {
    const handleChange = vi.fn();
    render(<Select options={options} onChange={handleChange} id="select" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('shows error state', () => {
    render(<Select error="Required" options={options} id="select" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('shows help text', () => {
    render(<Select help="Choose an option" options={options} id="select" />);
    expect(screen.getByText('Choose an option')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Select disabled options={options} id="select" />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('shows placeholder when value is empty', () => {
    render(<Select placeholder="Choose..." options={options} id="select" />);
    expect(screen.getByRole('combobox')).toHaveValue('');
  });
});