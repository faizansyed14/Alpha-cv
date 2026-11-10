'use client';
/**
 * The app's icon set: Phosphor line icons (crisp regular weight, like modern SaaS products), each with its own colour.
 *
 * Every screen imports its icons from here (same names as before), so the whole app changes together:
 *  - Duotone drawing: a solid line plus a soft tinted fill, instead of a thin grey outline.
 *  - A semantic colour per icon (people and navigation blue, success green, warnings amber, delete red, AI violet ...)
 *    that replaces the dull grey text classes (text-slate-400 and friends). An icon that is given a real colour
 *    (white on a button, red for an error, brand blue, ...) keeps it; an icon with no colour inherits its parent's.
 */
import * as React from 'react';
import {
  ArrowLeft as PhArrowLeft, ArrowRight as PhArrowRight, ArrowUp as PhArrowUp, SidebarSimple, ArrowSquareOut, ArrowsClockwise, Briefcase as PhBriefcase,
  BookmarkSimple, Brain as PhBrain, Bug as PhBug, Buildings, CalendarBlank, CalendarDots, CaretDown, CaretLeft, CaretRight, CaretUp, CaretUpDown, ChartBar, ChatCircle,
  ChatText, Check as PhCheck, CheckCircle as PhCheckCircle, CircleNotch, ClipboardText, Clock as PhClock, Code as PhCode, CodeBlock,
  DotsThree, Copy as PhCopy, Cpu as PhCpu, CloudArrowUp, CurrencyDollar, Database as PhDatabase, DotsSixVertical, DownloadSimple, Envelope, Eye as PhEye,
  EyeSlash, FileArrowDown, FileMagnifyingGlass, FileText as PhFileText, FileX, FloppyDisk, Flag as PhFlag, Funnel, GearSix,
  Globe as PhGlobe, GlobeHemisphereWest, GithubLogo, LinkedinLogo, HardDrives, Hourglass as PhHourglass, Info as PhInfo, Kanban, Key, List, Lock as PhLock,
  MagicWand, MagnifyingGlass, MagnifyingGlassMinus, MagnifyingGlassPlus, MapPin as PhMapPin, Medal, Megaphone as PhMegaphone,
  PaperPlaneTilt, PencilSimple, PencilSimpleLine, Phone as PhPhone, Play as PhPlay, PlayCircle as PhPlayCircle, Plus as PhPlus,
  Power as PhPower, Pulse, Shield as PhShield, ShieldCheck as PhShieldCheck, ShareNetwork, SignOut, SlidersHorizontal as PhSliders,
  Sparkle, SquaresFour, Tag as PhTag, Target as PhTarget, Timer as PhTimer, Translate, Trash, TrendDown, TrendUp, Trophy as PhTrophy, UploadSimple,
  User as PhUser, UserCircle, Users as PhUsers, Wallet as PhWallet, Warning, WarningCircle, X as PhX, XCircle as PhXCircle,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  className?: string;
  size?: number | string;
  strokeWidth?: number;   // accepted for compatibility; the weight is fixed
  absoluteStrokeWidth?: boolean;
}

/** Plain grey/ink text colours: these are replaced by the icon's own colour. */
const DULL = /^text-(slate|gray|neutral|zinc|stone)-\d{2,3}$|^text-ink(-muted)?$|^text-muted-foreground$/;

const ACCENT = /^text-(blue|indigo|violet|sky|cyan|amber|emerald|green|yellow|navy)-\d{2,3}$/;

const BLUE = 'text-navy-900';
const SKY = 'text-navy-800';
const VIOLET = 'text-navy-800';
const GREEN = 'text-emerald-600';
const AMBER = 'text-amber-500';
const RED = 'text-rose-500';
const CYAN = 'text-navy-700';
const INDIGO = 'text-navy-900';

function make(Base: PhosphorIcon, tone: string | null, name: string, weight: 'duotone' | 'bold' | 'regular' = 'regular') {
  const Comp = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
    { className = '', size, strokeWidth: _s, absoluteStrokeWidth: _a, ...rest },
    ref,
  ) {
    // Icons inherit parent colour; grey/accent classes dropped. White/red kept.
    const cls = className.split(/\s+/).filter((t) => t && !DULL.test(t) && !ACCENT.test(t)).join(' ');
    return <Base ref={ref} weight={weight} size={size} className={cls} {...(rest as object)} />;
  });
  Comp.displayName = name;
  return Comp;
}

/** Official brand mark (filled SVG) — colour baked in so it always looks real. */
function brandSvg(
  name: string,
  path: string,
  fill: string,
  viewBox = '0 0 24 24',
) {
  const Comp = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
    { className = '', size, strokeWidth: _s, absoluteStrokeWidth: _a, ...rest },
    ref,
  ) {
    const px = typeof size === 'number' ? size : undefined;
    return (
      <svg
        ref={ref}
        viewBox={viewBox}
        width={px}
        height={px}
        className={className}
        fill={fill}
        aria-hidden
        {...(rest as object)}
      >
        <path d={path} />
      </svg>
    );
  });
  Comp.displayName = name;
  return Comp;
}

// ---- people & places
export const User = make(PhUser, BLUE, 'User');
export const UserRound = make(UserCircle, BLUE, 'UserRound');
export const Users = make(PhUsers, BLUE, 'Users');
export const Building2 = make(Buildings, INDIGO, 'Building2');
export const MapPin = make(PhMapPin, RED, 'MapPin');
export const Globe = make(PhGlobe, SKY, 'Globe');
export const Globe2 = make(GlobeHemisphereWest, SKY, 'Globe2');
export const Languages = make(Translate, INDIGO, 'Languages');
export const Briefcase = make(PhBriefcase, INDIGO, 'Briefcase');

// ---- documents & data
export const FileText = make(PhFileText, BLUE, 'FileText');
export const FileCheck = make(FileMagnifyingGlass, GREEN, 'FileCheck');
export const FileDown = make(FileArrowDown, BLUE, 'FileDown');
export const FileWarning = make(FileX, AMBER, 'FileWarning');
export const ClipboardList = make(ClipboardText, VIOLET, 'ClipboardList');
export const Database = make(PhDatabase, CYAN, 'Database');
export const Server = make(HardDrives, CYAN, 'Server');
export const Cpu = make(PhCpu, VIOLET, 'Cpu');
export const Activity = make(Pulse, RED, 'Activity');
export const BarChart3 = make(ChartBar, CYAN, 'BarChart3');
export const Tag = make(PhTag, AMBER, 'Tag');
export const Tags = make(PhTag, AMBER, 'Tags');

// ---- AI, goals, awards
export const Sparkles = make(Sparkle, VIOLET, 'Sparkles');
export const Brain = make(PhBrain, VIOLET, 'Brain');
export const Wand2 = make(MagicWand, VIOLET, 'Wand2');
export const Target = make(PhTarget, VIOLET, 'Target');
export const Award = make(Medal, AMBER, 'Award');
export const Trophy = make(PhTrophy, AMBER, 'Trophy');
export const Flag = make(PhFlag, RED, 'Flag');
export const TrendingUp = make(TrendUp, GREEN, 'TrendingUp');
export const TrendingDown = make(TrendDown, RED, 'TrendingDown');
export const Code = make(PhCode, VIOLET, 'Code');
export const Code2 = make(CodeBlock, VIOLET, 'Code2');

// ---- time
export const Calendar = make(CalendarBlank, SKY, 'Calendar');
export const CalendarDays = make(CalendarDots, SKY, 'CalendarDays');
export const Clock = make(PhClock, SKY, 'Clock');
export const Bug = make(PhBug, RED, 'Bug');
export const Bookmark = make(BookmarkSimple, SKY, 'Bookmark');
export const Timer = make(PhTimer, SKY, 'Timer');
export const Hourglass = make(PhHourglass, AMBER, 'Hourglass');

// ---- money, contact
export const DollarSign = make(CurrencyDollar, GREEN, 'DollarSign');
export const Wallet = make(PhWallet, GREEN, 'Wallet');
export const Mail = make(Envelope, BLUE, 'Mail');
export const Phone = make(PhPhone, GREEN, 'Phone');
export const MessageCircle = make(ChatCircle, GREEN, 'MessageCircle');
export const MessageSquare = make(ChatText, CYAN, 'MessageSquare');
export const Megaphone = make(PhMegaphone, AMBER, 'Megaphone');
// Official brand marks (real logo paths + brand colours)
export const Linkedin = brandSvg(
  'Linkedin',
  'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  '#0A66C2',
);
export const Github = brandSvg(
  'Github',
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  '#24292F',
);
export const WhatsApp = brandSvg(
  'WhatsApp',
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z',
  '#25D366',
);
/** Phosphor fallbacks if a plain line mark is needed */
export const LinkedinLine = make(LinkedinLogo, BLUE, 'LinkedinLine');
export const GithubLine = make(GithubLogo, BLUE, 'GithubLine');

// ---- status & feedback
export const Check = make(PhCheck, GREEN, 'Check', 'bold');
export const CheckCircle = make(PhCheckCircle, GREEN, 'CheckCircle');
export const CheckCircle2 = make(PhCheckCircle, GREEN, 'CheckCircle2');
export const XCircle = make(PhXCircle, RED, 'XCircle');
export const AlertCircle = make(WarningCircle, RED, 'AlertCircle');
export const AlertTriangle = make(Warning, AMBER, 'AlertTriangle');
export const Info = make(PhInfo, SKY, 'Info');
export const Shield = make(PhShield, BLUE, 'Shield');
export const ShieldCheck = make(PhShieldCheck, GREEN, 'ShieldCheck');
export const Lock = make(PhLock, AMBER, 'Lock');
export const KeyRound = make(Key, AMBER, 'KeyRound');

// ---- actions
export const Eye = make(PhEye, BLUE, 'Eye');
export const EyeOff = make(EyeSlash, null, 'EyeOff');
export const Pencil = make(PencilSimple, AMBER, 'Pencil');
export const Edit3 = make(PencilSimpleLine, AMBER, 'Edit3');
export const Trash2 = make(Trash, RED, 'Trash2');
export const Save = make(FloppyDisk, BLUE, 'Save');
export const Copy = make(PhCopy, null, 'Copy');
export const Download = make(DownloadSimple, BLUE, 'Download');
export const Upload = make(UploadSimple, BLUE, 'Upload');
export const UploadCloud = make(CloudArrowUp, BLUE, 'UploadCloud');
export const ExternalLink = make(ArrowSquareOut, BLUE, 'ExternalLink');
export const Share2 = make(ShareNetwork, BLUE, 'Share2');
export const Send = make(PaperPlaneTilt, SKY, 'Send');
export const RefreshCw = make(ArrowsClockwise, BLUE, 'RefreshCw');
export const Search = make(MagnifyingGlass, BLUE, 'Search');
export const Filter = make(Funnel, BLUE, 'Filter');
export const SlidersHorizontal = make(PhSliders, BLUE, 'SlidersHorizontal');
export const Settings = make(GearSix, null, 'Settings');
export const Power = make(PhPower, AMBER, 'Power');
export const Play = make(PhPlay, GREEN, 'Play');
export const PlayCircle = make(PhPlayCircle, GREEN, 'PlayCircle');
export const LogOut = make(SignOut, RED, 'LogOut');
export const Plus = make(PhPlus, null, 'Plus', 'bold');
export const X = make(PhX, null, 'X', 'bold');
export const Loader2 = make(CircleNotch, null, 'Loader2', 'bold');
export const LayoutDashboard = make(SquaresFour, BLUE, 'LayoutDashboard');
export const KanbanSquare = make(Kanban, VIOLET, 'KanbanSquare');

// ---- navigation chrome (kept neutral so the interface does not look busy)
export const ArrowLeft = make(PhArrowLeft, null, 'ArrowLeft', 'bold');
export const ArrowRight = make(PhArrowRight, null, 'ArrowRight', 'bold');
export const ArrowUp = make(PhArrowUp, BLUE, 'ArrowUp', 'bold');
export const ChevronDown = make(CaretDown, null, 'ChevronDown', 'bold');
export const ChevronUp = make(CaretUp, null, 'ChevronUp', 'bold');
export const ChevronLeft = make(CaretLeft, null, 'ChevronLeft', 'bold');
export const ChevronRight = make(CaretRight, null, 'ChevronRight', 'bold');
export const ChevronsUpDown = make(CaretUpDown, null, 'ChevronsUpDown', 'bold');
export const MoreHorizontal = make(DotsThree, null, 'MoreHorizontal', 'bold');
export const GripVertical = make(DotsSixVertical, null, 'GripVertical', 'bold');
export const Menu = make(List, null, 'Menu', 'bold');
export const ZoomIn = make(MagnifyingGlassPlus, null, 'ZoomIn');
export const ZoomOut = make(MagnifyingGlassMinus, null, 'ZoomOut');
export const PanelLeft = make(SidebarSimple, null, 'PanelLeft');
