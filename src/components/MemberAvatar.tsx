'use client';

import { useState } from 'react';
import { getInitials } from './ChoreIcon';

interface MemberAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<MemberAvatarProps['size']>, string> = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-8 h-8 text-[11px]',
  lg: 'w-10 h-10 text-xs',
};

export function MemberAvatar({
  name,
  avatarUrl,
  size = 'md',
  className = '',
}: MemberAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const sz = SIZE_CLASSES[size];

  if (avatarUrl && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        onError={() => setImgFailed(true)}
        className={`${sz} rounded-full object-cover border border-[#E5E7EB] dark:border-[#334155] shrink-0 bg-[#F3F4F6] dark:bg-[#0F172A] ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sz} rounded-full bg-[#ECFDF5] dark:bg-[#064E3B] border border-[#A7F3D0] dark:border-[#047857] text-[#059669] dark:text-[#34D399] font-bold flex items-center justify-center shrink-0 ${className}`}
    >
      {getInitials(name)}
    </div>
  );
}
