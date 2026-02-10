import type { SplitType, GroupStatus } from "@/lib/types";

// Split type labels for expense forms
export const SPLIT_TYPE_LABELS: Record<SplitType, string> = {
  equal: "A partes iguales",
  exact: "Cantidades exactas",
  percentage: "Por porcentaje",
  shares: "Por partes",
};

// Group status configuration
export const STATUS_CONFIG: Record<
  GroupStatus,
  { label: string; className: string }
> = {
  active: {
    label: "Activo",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  settling: {
    label: "Liquidando",
    className: "bg-yellow-50 text-yellow-700 border-yellow-200",
  },
  archived: {
    label: "Archivado",
    className: "bg-neutral-100 text-neutral-500 border-neutral-200",
  },
};
