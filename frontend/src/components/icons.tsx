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
  Brain as PhBrain, Buildings, CalendarBlank, CalendarDots, CaretDown, CaretLeft, CaretRight, CaretUp, CaretUpDown, ChartBar, ChatCircle,
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
    // Icons take the colour of the text they sit beside: grey and accent colour classes are dropped so they inherit.
    // Red (delete, errors) and white (on buttons) are kept.
    const cls = className.split(/\s+/).filter((t) => t && !DULL.test(t) && !ACCENT.test(t)).join(' ');
    return <Base ref={ref} weight={weight} size={size} className={cls} {...(rest as object)} />;
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
export const Linkedin = make(LinkedinLogo, BLUE, 'Linkedin');
export const Github = make(GithubLogo, BLUE, 'Github');

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
