import {
  Sparkles,
  Landmark,
  Box,
  Palette,
  Heart,
  Gamepad2,
  Clapperboard,
  Globe2,
  Music2,
  type LucideIcon
} from 'lucide-vue-next'
import {
  STYLE_CATEGORIES,
  type StyleCategory,
  type StyleCategoryIcon
} from '#shared/types/styles'

const ICON_COMPONENTS: Record<StyleCategoryIcon, LucideIcon> = {
  sparkles: Sparkles,
  landmark: Landmark,
  box: Box,
  palette: Palette,
  heart: Heart,
  gamepad2: Gamepad2,
  clapperboard: Clapperboard,
  globe2: Globe2,
  music2: Music2
}

const categoryIconMap = new Map<StyleCategory, StyleCategoryIcon>(
  STYLE_CATEGORIES.map(item => [item.id, item.icon])
)

export function resolveStyleCategoryIconByName(icon?: StyleCategoryIcon | null): LucideIcon {
  if (!icon) return Palette
  return ICON_COMPONENTS[icon] || Palette
}

export function resolveStyleCategoryIcon(category: StyleCategory): LucideIcon {
  return resolveStyleCategoryIconByName(categoryIconMap.get(category) || null)
}
