import {
  Banknote,
  Users,
  Star,
  Pill,
  HeartPulse,
  FileText,
  Stethoscope,
  CreditCard,
  ClipboardList,
  Building2,
} from "lucide-react";

export const SERVICE_ICONS = {
  banknote: Banknote,
  users: Users,
  star: Star,
  pill: Pill,
  "heart-pulse": HeartPulse,
  "file-text": FileText,
  stethoscope: Stethoscope,
  "credit-card": CreditCard,
  "clipboard-list": ClipboardList,
  building: Building2,
};

export const getServiceIcon = (name) => SERVICE_ICONS[name] || Users;
