import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import api from '../lib/api';
import AuthCard from '../components/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const forgotSchema = z.object({
  email: z.string().email('Enter a valid email address'),
});

type ForgotValues = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotValues) => {
    setError('');
    try {
      const res = await api.post('/api/auth/forgot-password', values);
      setMessage(res.data.message);
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <AuthCard title="Forgot Password" subtitle="Enter your email to receive a reset link">
      {submitted ? (
        <div className="py-2 text-center">
          <Mail className="mx-auto mb-4 size-10 text-primary" />
          <p className="mb-6 text-sm text-muted-foreground">{message}</p>
          <Link to="/login" className="text-sm font-medium text-primary hover:underline">
            Back to Sign In
          </Link>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="Enter your email" {...field} />
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
              {form.formState.isSubmitting ? 'Sending...' : 'Send Reset Link'}
            </Button>

            <div className="text-center">
              <Link to="/login" className="text-sm font-medium text-primary hover:underline">
                Back to Sign In
              </Link>
            </div>
          </form>
        </Form>
      )}
    </AuthCard>
  );
}
