import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './toast';

const TestComponent = () => {
  const { showToast, dismissToast, toasts } = useToast();
  return (
    <div>
      <button onClick={() => showToast('success', 'Success message')}>Show Success</button>
      <button onClick={() => showToast('error', 'Error message')}>Show Error</button>
      <button onClick={() => showToast('warning', 'Warning message')}>Show Warning</button>
      <button onClick={() => showToast('info', 'Info message')}>Show Info</button>
      <div data-testid="toast-count">Toasts: {toasts.length}</div>
      {toasts.map(toast => (
        <div key={toast.id} data-testid={`toast-${toast.id}`}>
          <span>{toast.message}</span>
          <button onClick={() => dismissToast(toast.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
};

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('provides toast context', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );
    expect(screen.getByTestId('toast-count')).toHaveTextContent('Toasts: 0');
  });

  it('shows success toast', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Show Success'));
    expect(screen.getByTestId('toast-count')).toHaveTextContent('Toasts: 1');
    expect(screen.getAllByText('Success message').length).toBeGreaterThan(0);
  });

  it('shows error toast', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Show Error'));
    expect(screen.getByTestId('toast-count')).toHaveTextContent('Toasts: 1');
    expect(screen.getAllByText('Error message').length).toBeGreaterThan(0);
  });

  it('shows multiple toasts', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));
    expect(screen.getByTestId('toast-count')).toHaveTextContent('Toasts: 2');
  });

  it('dismisses toast when dismiss button clicked', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Show Success'));
    const dismissButton = screen.getByText('Dismiss');
    fireEvent.click(dismissButton);
    expect(screen.getByTestId('toast-count')).toHaveTextContent('Toasts: 0');
  });

  it('auto-dismisses toast after 5 seconds', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Show Success'));
    expect(screen.getByTestId('toast-count')).toHaveTextContent('Toasts: 1');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('toast-count')).toHaveTextContent('Toasts: 0');
  });

  it('throws error when useToast used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      render(<TestComponent />);
    }).toThrow('useToast must be used within a ToastProvider');
    consoleError.mockRestore();
  });
});