import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { authService } from '@/services/authService';
import LoginPage from '@/app/login/page';
import RegisterPage from '@/app/register/page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('@/services/authService', () => ({
  authService: {
    login: vi.fn(),
    register: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeAllSessions: vi.fn(),
  },
}));

describe('Authentication Pages', () => {
  const mockUser = {
    id: '1',
    email: 'test@example.com',
    createdAt: '2023-01-01T00:00:00Z',
  };

  const mockTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    defaultWorkspaceId: 'workspace-1',
    user: mockUser,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Login Page', () => {
    it('should render login form', () => {
      render(<LoginPage />);
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('should handle successful login', async () => {
      vi.mocked(authService.login).mockResolvedValue(mockTokens);

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await userEvent.type(emailInput, 'test@example.com');
      await userEvent.type(passwordInput, 'password123');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(authService.login).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
        });
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('should show error on failed login', async () => {
      vi.mocked(authService.login).mockRejectedValue({
        response: { data: { error: { message: 'Invalid credentials' } } },
      });

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await userEvent.type(emailInput, 'test@example.com');
      await userEvent.type(passwordInput, 'wrongpassword');
      await userEvent.click(submitButton);

      expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });

  describe('Register Page', () => {
    it('should render registration form', () => {
      render(<RegisterPage />);
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    });

    it('should handle successful registration', async () => {
      vi.mocked(authService.register).mockResolvedValue(mockTokens);

      render(<RegisterPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /create account/i });

      await userEvent.type(emailInput, 'test@example.com');
      await userEvent.type(passwordInput, 'password123');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(authService.register).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
        });
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('should show error on failed registration', async () => {
      vi.mocked(authService.register).mockRejectedValue({
        response: { data: { error: { message: 'Email already exists' } } },
      });

      render(<RegisterPage />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /create account/i });

      await userEvent.type(emailInput, 'test@example.com');
      await userEvent.type(passwordInput, 'password123');
      await userEvent.click(submitButton);

      expect(await screen.findByText(/email already exists/i)).toBeInTheDocument();
    });
  });
});
