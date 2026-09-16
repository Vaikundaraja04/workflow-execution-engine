'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authService } from '@/services/authService';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: z.infer<typeof registerSchema>) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const { accessToken, refreshToken, user, defaultWorkspaceId } = await authService.register(data);
      // Store tokens
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      // Store user and default workspace
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('defaultWorkspaceId', defaultWorkspaceId);
      // Redirect to dashboard
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 p-4">
        <h2 className="text-2xl font-bold text-center">Create your account</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-gray-700">
              Email address
            </label>
            <Input
              id="email"
              type="email"
              placeholder="Enter your email"
              {...register('email')}
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-gray-700">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="Create a password"
              {...register('password')}
              className={errors.password ? 'border-red-500' : ''}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </Button>
          {error && (
            <p className="mt-2 text-sm text-red-600 text-center">{error}</p>
          )}
          {success && (
            <p className="mt-2 text-sm text-green-600 text-center">{success}</p>
          )}
        </form>
        <div className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <a href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}