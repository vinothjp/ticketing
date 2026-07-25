import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../lib/api';
import AuthCard from '../components/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const resetSchema = z
  .object({
    newPassword: z.string().min(8, 'Min 8 characters'),
    confirm: z.string().min(8, 'Min 8 characters'),
  })
  .refine((data) => data.newPassword === data.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type ResetValues = z.infer<typeof resetSchema>;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '', confirm: '' },
  });

  const onSubmit = async (values: ResetValues) => {
    setError('');
    try {
      await api.post('/api/auth/reset-password', { token, newPassword: values.newPassword });
      navigate('/login', { state: { message: 'Password reset successfully. Please sign in.' } });
    } catch {
      setError('Invalid or expired reset link.');
    }
  };

  return (
    <AuthCard title="Reset Password" subtitle="Choose a new password for your account">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New Password</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="Min 8 characters" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm Password</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="Repeat password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Resetting...' : 'Reset Password'}
          </Button>

          <div className="text-center">
            <Link to="/login" className="text-sm font-medium text-primary hover:underline">
              Back to Sign In
            </Link>
          </div>
        </form>
      </Form>
    </AuthCard>
  );
}
