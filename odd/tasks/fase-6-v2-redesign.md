# Fase 6 — v2 Visual Redesign + Multi-project + Identity

## Objetivo

Llevar el visual diseñado en OpenPencil al código real, sacando Tailwind, definiendo CSS tokens themeable, e implementando los features nuevos (copy-paste de IDs, motion signatures, keyboard rituals, empty states, multi-project switcher, graph links).

## Por qué

- Tailwind no permite themes dinámicos sin CSS vars (queremos Obsidian-style + Light + custom theme files como en Obsidian).
- El nuevo brand (lockup, monogram, "gt") debe aparecer en código.
- Las 4 features nuevas (copy-paste, motion, shortcuts, empty states) están diseñadas pero no implementadas.
- Multi-project + Graph son los features más visibles del roadmap.

## Alcance

### Phase 6A — Foundation
- Quitar Tailwind de package.json + postcss.config.js
- index.css con CSS custom properties (--bg, --bg-subtle, --bg-elevated, --bg-hover, --border, --border-strong, --fg, --fg-muted, --fg-subtle, --accent, --accent-hover, --accent-soft, --status-*, --priority-*)
- Variables de typography (--font-sans, --font-mono, --text-xs, etc)
- Variables de spacing (--space-1 a --space-8) + radius (--radius-sm/md/lg/pill) + shadows (--shadow-card, --shadow-elevated)
- Convertir componentes existentes de Tailwind classes a vanilla CSS (manteniendo funcionalidad idéntica)
- Tests visuales pasan

### Phase 6B — Identity
- AppHeader: brand lockup (monogram + "gitteam" mono)
- Avatar: naranja → violet (consistencia con accent)
- Reemplazar placeholder "astivens" con "you"
- SidePanel header con TKT ID grande + tag In Progress

### Phase 6C — Motion + Rituals
- Cursor blink en SidePanel markdown editor (CSS @keyframes)
- Sync dot pulse en AppHeader indicator (CSS @keyframes)
- New ticket pulse animation (CSS @keyframes)
- Y shortcut para copy de TKT ID
- G L / G K / G A navigation con prefijo
- Cmd+P context-aware (palette si no hay proyectos, switcher si hay)
- Empty states: no tickets / no project / no results / disconnected

### Phase 6D — Multi-project (BACKEND)
- Nuevo directorio `~/.gitteam-projects/<project-id>/` por proyecto
- Cada proyecto tiene su propio data dir + GitConfig
- Backend commands:
  - `list_projects` — lista todos los proyectos configurados
  - `add_project` — crea nuevo proyecto
  - `remove_project` — borra un proyecto
  - `switch_project` — cambia el proyecto activo
  - `get_active_project` — devuelve el proyecto activo
- `data_dir()` → `data_dir_for(project_id)`
- Sync state machine actualizado para multi-project

### Phase 6E — Multi-project UI
- ProjectSwitcher dropdown en AppHeader (reemplaza "astivens")
- Closed pill (monogram + repo + sync dot + chevron)
- Open dropdown (search + 3 proyectos con sync states + "Link new" CTA con Cmd N)
- Carga desde `list_projects` y persiste `active_project`

### Phase 6F — Graph (BACKEND)
- Links entre tickets — `frontmatter: links: [TKT-1041, TKT-1039]`
- Commands:
  - `link_tickets(from, to)` 
  - `unlink_tickets(from, to)`
  - `get_graph()` — devuelve nodes + edges
- Parsing del sidecar in el body markdown

### Phase 6G — Graph UI
- Render del graph con SVG o canvas
- Drag para reordenar
- Click en nodo → abre el SidePanel

## Constraints

- Conventional Commits
- Tests visuales pasan (yarn build)
- No regresiones: features existentes siguen funcionando
- Documentación actualizada (README + feature doc)

## Acceptance Criteria

- [ ] Tailwind removido completamente
- [ ] CSS custom properties themeable via `data-theme` attribute
- [ ] Light theme funcional + Dark theme funcional
- [ ] Brand "gitteam" + monogram visible en header
- [ ] Copy-paste de TKT IDs funciona con feedback toast
- [ ] Motion signatures (cursor blink, sync pulse, new ticket glow) funcionan
- [ ] Y shortcut para yank funciona
- [ ] G L / G K / G A navegación funciona
- [ ] Empty states tienen copy con carácter
- [ ] Multi-project: listar, switch, add nuevos funciona
- [ ] Graph: links entre tickets se renderizan
- [ ] tsc --noEmit pasa
- [ ] pnpm build pasa

## Progress

- [x] Phase 6A — Foundation (Tailwind out, CSS tokens in)
- [x] Phase 6B — Identity (brand lockup, avatar violet, placeholders)
- [x] Phase 6C — Motion + Rituals (CSS animations, shortcuts, empty states)
- [x] Phase 6D — Multi-project backend (Project type, 5 new commands, smart data_dir routing)
- [x] Phase 6E — Multi-project UI (ProjectSwitcher dropdown, NoProjectEmptyState)
- [ ] Phase 6F — Graph backend (links in markdown, get_graph command)
- [ ] Phase 6G — Graph UI (canvas/SVG rendering)

## Related

- Design System en OpenPencil: tab-1 page 611929921:17
- Memory: design-system-v2 topic_key
- ui-ux-audit.md: issues P0-3 (side panel), P1-9 (markdown preview), P1-13 (theme toggle)

## Work-unit commits planned

1. `feat(css): remove tailwind, add CSS custom properties`
3. `feat(theme): default theme + light theme tokens`
5. `feat(header): brand lockup + violet avatar`
7. `feat(copy): yank TKT ID with hover button + Y shortcut`
9. `feat(motion): cursor blink, sync pulse, new ticket glow`
11. `feat(empty): copy + CTAs for 4 empty states`
13. `feat(shortcuts): G prefix navigation, context-aware Cmd+P`
15. `feat(backend): multi-project storage + list/switch commands`
17. `feat(ui): project switcher dropdown`
19. `feat(backend): ticket links in frontmatter + graph command`
21. `feat(ui): graph view rendering`
23. `docs: update README with v2 features`