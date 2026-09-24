import {
  Award,
  Banknote,
  CircleDollarSign,
  Coins,
  CreditCard,
  Gift,
  Heart,
  Landmark,
  Medal,
  Sparkles,
  Star,
  Trophy,
  WalletCards,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  award: Award,
  banknote: Banknote,
  "circle-dollar-sign": CircleDollarSign,
  coins: Coins,
  "credit-card": CreditCard,
  gift: Gift,
  heart: Heart,
  landmark: Landmark,
  medal: Medal,
  sparkles: Sparkles,
  star: Star,
  trophy: Trophy,
  wallet: WalletCards,
  zap: Zap,
};

function isImageIcon(value: string): boolean {
  return value.startsWith("data:image/") || /^https?:\/\//i.test(value);
}

export function PointTypeIcon({
  icon,
  className = "h-5 w-5",
}: {
  icon: string | null | undefined;
  className?: string;
}): JSX.Element {
  if (icon && isImageIcon(icon)) {
    return <img src={icon} alt="" className={`${className} rounded object-cover`} />;
  }
  const Icon = icon ? ICONS[icon] : undefined;
  if (Icon) return <Icon className={className} aria-hidden="true" />;
  if (icon && icon.length <= 8) {
    return (
      <span className={`${className} inline-flex items-center justify-center text-base`} aria-hidden="true">
        {icon}
      </span>
    );
  }
  return <WalletCards className={className} aria-hidden="true" />;
}
