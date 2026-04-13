import {
  Sparkles,
  Landmark,
  Box,
  Palette,
  Clock3,
  Heart,
  PenTool,
  MessageSquare,
  Gamepad2,
  Star,
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
  clock3: Clock3,
  heart: Heart,
  pen_tool: PenTool,
  message_square: MessageSquare,
  gamepad2: Gamepad2,
  star: Star
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
