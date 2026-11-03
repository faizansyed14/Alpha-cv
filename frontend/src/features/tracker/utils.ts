export function formatDdMmYy(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

export function isOverdue(next: string | null | undefined, stage: string | null | undefined) {
  if (!next) return false;
  if ((stage || '').trim().toLowerCase() === 'positions closed') return false;
  const d = new Date(next);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d < today;
}

export function stageBadgeClass(stage: string, overdue: boolean) {
  if (overdue) return 'bg-gray-50 text-gray-900 border-gray-200 line-through opacity-70';
  const k = (stage || '').toLowerCase();
  if (k.includes('scheduled')) return 'bg-brand-600 text-white border-transparent';
  if (k.includes('pending') || k.includes('profiles submitted') || k.includes('rework') || k.includes('hold')) {
    return 'bg-blue-50 text-blue-700 border-blue-200 font-semibold';
  }
  if (k.includes('closed') || k.includes('cancelled')) return 'bg-gray-50 text-gray-400 border-gray-200';
  return 'bg-white text-gray-900 border-gray-200';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function isJoinedStatus(s?: string | null) {
  const k = String(s || '').toLowerCase();
  return k.includes('joined') && !k.includes('pending');
}

export function _norm(s?: string | null) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBackoutStatus(s?: string | null) {
  const k = _norm(s);
  return (
    k === 'backout' ||
    k === 'backouts' ||
    k === 'back out' ||
    k === 'back-out' ||
    k === 'backed out' ||
    k.replace(/\s/g, '') === 'backedout' ||
    k.replace(/[\s-]/g, '') === 'backout' ||
    k.includes('backout') ||
    k.includes('backed out')
  );
}

export function isOfferReleasedStatus(s?: string | null) {
  const k = _norm(s);
  return k === 'offer released' || k.includes('offer released');
}

export function statusColor(s: string) {
  const k = s.toLowerCase();
  if (k.includes('joined') && !k.includes('pending')) return 'bg-brand-600 text-white border-transparent';
  if (k.includes('visa rejected') || k.includes('offer declined') || k.includes('cancelled')) return 'bg-gray-50 text-gray-400 border-gray-200';
  if (k.includes('offer released') || k.includes('offer accepted') || k.includes('selected') || k.includes('open')) return 'bg-brand-600 text-white border-transparent';
  if (k.includes('security') || k.includes('clearance') || k.includes('visa') || k.includes('notice') || k.includes('profiles submitted') || k.includes('scheduled') || k.includes('pending') || k.includes('hold')) {
    return 'bg-blue-50 text-blue-700 border-blue-200 font-semibold';
  }
  return 'bg-white text-gray-900 border-gray-200';
}
