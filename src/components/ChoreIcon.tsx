'use client';

import {
  Bath,
  CheckCircle2,
  Droplets,
  Shirt,
  ShoppingBag,
  Sparkles,
  Sun,
  Trash2,
  Utensils,
} from 'lucide-react';

export const CHORE_ICON_OPTIONS = [
  { key: 'droplets', label: 'Lau nhà' },
  { key: 'utensils', label: 'Rửa chén' },
  { key: 'sparkles', label: 'Quét dọn' },
  { key: 'trash', label: 'Đổ rác' },
  { key: 'bath', label: 'Vệ sinh' },
  { key: 'shirt', label: 'Giặt phơi' },
  { key: 'shopping-bag', label: 'Đi chợ' },
  { key: 'sun', label: 'Sân vườn' },
  { key: 'check-circle', label: 'Khác' },
] as const;

export function ChoreIcon({ icon, className = 'w-5 h-5' }: { icon: string; className?: string }) {
  switch (icon) {
    case 'droplets':
      return <Droplets className={className} strokeWidth={1.85} />;
    case 'utensils':
      return <Utensils className={className} strokeWidth={1.85} />;
    case 'trash':
      return <Trash2 className={className} strokeWidth={1.85} />;
    case 'bath':
      return <Bath className={className} strokeWidth={1.85} />;
    case 'shirt':
      return <Shirt className={className} strokeWidth={1.85} />;
    case 'shopping-bag':
      return <ShoppingBag className={className} strokeWidth={1.85} />;
    case 'sun':
      return <Sun className={className} strokeWidth={1.85} />;
    case 'check-circle':
      return <CheckCircle2 className={className} strokeWidth={1.85} />;
    case 'sparkles':
    default:
      return <Sparkles className={className} strokeWidth={1.85} />;
  }
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
