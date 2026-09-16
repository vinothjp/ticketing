import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthCard from '../components/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const loginSchema = z.object({
  username: z.string().min(1, 'Username or email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginValues = z.infer<typeof loginSchema>;

interface OtpState {
  challengeId: string;
  otpSentTo: string;
  credentials: { username: string; password: string };
}

export default function LoginPage() {
  const { login, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpState, setOtpState] = useState<OtpState | null>(null);
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  // Auto-focus OTP input when it appears
  useEffect(() => {
    if (otpState) otpInputRef.current?.focus();
  }, [otpState]);

  const onSubmit = async (values: LoginValues) => {
    setError('');
    try {
      const result = await login(values.username, values.password);
      if ('requiresOtp' in result) {
        setOtpState({
          challengeId: result.challengeId,
          otpSentTo: result.otpSentTo,
          credentials: values,
        });
        return;
      }
      navigate(result.user.roles.includes('SuperAdmin') ? '/platform/clients' : '/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Invalid username or password');
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpState || otp.length !== 6) return;
    setError('');
    setVerifying(true);
    try {
      const user = await verifyOtp(otpState.challengeId, otp);
      navigate(user.roles.includes('SuperAdmin') ? '/platform/clients' : '/dashboard');
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Verification failed';
      setError(msg);
      // If challenge expired or exhausted, go back to login
      if (err?.response?.status === 401 && msg.includes('log in again')) {
        setOtpState(null);
        setOtp('');
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpState) return;
    setError('');
    setResending(true);
    try {
      const result = await login(otpState.credentials.username, otpState.credentials.password);
      if ('requiresOtp' in result) {
        setOtpState({
          challengeId: result.challengeId,
          otpSentTo: result.otpSentTo,
          credentials: otpState.credentials,
        });
        setOtp('');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  // ── OTP verification screen ───────────────────────────────
  if (otpState) {
    return (
      <AuthCard title="Verification Required" subtitle="Two-factor authentication">
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <ShieldCheck className="size-5 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              A 6-digit code has been sent to <strong className="text-foreground">{otpState.otpSentTo}</strong>
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Verification Code</label>
            <Input
              ref={otpInputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp(); }}
              className="text-center text-2xl font-mono tracking-[0.3em]"
              autoComplete="one-time-code"
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleVerifyOtp}
            disabled={otp.length !== 6 || verifying}
          >
            {verifying ? 'Verifying...' : 'Verify & Sign In'}
          </Button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => { setOtpState(null); setOtp(''); setError(''); }}
              className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Back to login
            </button>
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={resending}
              className="font-medium text-primary hover:underline disabled:opacity-50"
            >
              {resending ? 'Sending...' : 'Resend code'}
            </button>
          </div>
        </div>
      </AuthCard>
    );
  }

  // ── Normal login screen ───────────────────────────────────
  return (
    <AuthCard title="Welcome Back" subtitle="Sign in to your account">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username or Email</FormLabel>
                <FormControl>
                  <Input placeholder="Enter username or email" autoComplete="username" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter password"
                      autoComplete="current-password"
                      className="pr-10"
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Toggle password visibility"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
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
            {form.formState.isSubmitting ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </Form>

      <div className="mt-5 text-center">
        <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
    </AuthCard>
  );
}
