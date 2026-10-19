import type { SameShape } from "../shape";
import { common as enCommon } from "../en/common";

/** Labels shared by more than one screen. */
export const common: SameShape<typeof enCommon> = {
  cancel: "Cancelar",
  save: "Guardar",
  delete: "Eliminar",
  close: "Cerrar",
  retry: "Reintentar",
  copy: "Copiar",
  copied: "Copiado",
  loading: "Cargando…",
  search: "Buscar…",
  language: "Idioma",
  justNow: "ahora mismo",
  secondsAgo: (n: number) => `hace ${n}s`,
  minutesAgo: (n: number) => `hace ${n} min`,
  hoursAgo: (n: number) => `hace ${n} h`,
  daysAgo: (n: number) => `hace ${n} d`,
};
