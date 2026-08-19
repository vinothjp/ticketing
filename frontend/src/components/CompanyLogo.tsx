import { Building2 } from 'lucide-react';
import { assetUrl } from '@/lib/assetUrl';

// Shows a client's uploaded logo; falls back to a generic building when none.
// The value is a server path ("/uploads/logos/…"), not a data URL, so it goes
// through assetUrl() — unlike ProductIcon, which renders inline data URLs.
export default function CompanyLogo({ logoUrl, className = 'size-12' }: { logoUrl?: string | null; className?: string }) {
  const src = assetUrl(logoUrl);
  if (src) {
    return (
      <div className={`flex items-center justify-center overflow-hidden rounded-lg bg-muted ${className}`}>
        <img src={src} alt="" className="size-full object-contain" />
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center rounded-lg bg-primary/10 text-primary ${className}`}>
      <Building2 className="size-1/2" />
    </div>
  );
}
