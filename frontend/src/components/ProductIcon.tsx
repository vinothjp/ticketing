import { Boxes } from 'lucide-react';

// Shows the product's own uploaded image; falls back to a generic cube when none.
export default function ProductIcon({ imageUrl, className = 'size-12' }: { imageUrl?: string | null; className?: string }) {
  if (imageUrl) {
    return (
      <div className={`flex items-center justify-center overflow-hidden rounded-lg bg-muted ${className}`}>
        <img src={imageUrl} alt="" className="size-full object-contain" />
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center rounded-lg bg-primary/10 text-primary ${className}`}>
      <Boxes className="size-1/2" />
    </div>
  );
}
