import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  ArrowRight,
  Box,
  ChartNoAxesColumn,
  Check,
  CircleHelp,
  CircleX,
  CreditCard,
  Folder,
  History,
  LayoutGrid,
  Library,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCirclePlus,
  Paperclip,
  PenLine,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  ChevronDown,
  TriangleAlert,
  Users,
  Workflow,
} from 'lucide-react';

const icons = {
  plus: Plus,
  chat: MessageCirclePlus,
  history: History,
  folder: Folder,
  library: Library,
  lock: LockKeyhole,
  chevronDown: ChevronDown,
  workflow: Workflow,
  chart: ChartNoAxesColumn,
  card: CreditCard,
  settings: Settings,
  help: CircleHelp,
  arrow: ArrowRight,
  attach: Paperclip,
  write: PenLine,
  cube: Box,
  shield: ShieldCheck,
  users: Users,
  grid: LayoutGrid,
  menu: Menu,
  logout: LogOut,
  sun: Sun,
  search: Search,
  check: Check,
  warning: TriangleAlert,
  error: CircleX,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export function Icon({ name, ...props }: LucideProps & { name: IconName }) {
  const LucideIcon = icons[name];
  return (
    <LucideIcon aria-hidden="true" size={20} strokeWidth={1.7} {...props} />
  );
}
