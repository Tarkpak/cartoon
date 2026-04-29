import { STYLE_DESCRIPTION_OVERRIDES } from './style-descriptions.generated'

// 风格分类
export type StyleCategory
  = | 'japanese_anime' | 'chinese_style' | '3d_render' | 'illustration'
    | 'retro' | 'cute_q' | 'artistic' | 'comic' | 'pixel_game' | 'special'

export type StyleCategoryIcon
  = | 'sparkles'
    | 'landmark'
    | 'box'
    | 'palette'
    | 'clock3'
    | 'heart'
    | 'pen_tool'
    | 'message_square'
    | 'gamepad2'
    | 'star'

export interface StylePreset {
  id: string
  name: string
  nameEn: string
  category: StyleCategory
  description: string
  prompt: string
  negativePrompt?: string
  thumbnail?: string
  isNew?: boolean
  isPro?: boolean
}

export interface StyleCategoryInfo {
  id: StyleCategory
  name: string
  nameEn: string
  icon: StyleCategoryIcon
}

export const STYLE_CATEGORIES: StyleCategoryInfo[] = [
  { id: 'japanese_anime', name: '日系动漫', nameEn: 'Japanese Anime', icon: 'sparkles' },
  { id: 'chinese_style', name: '国风', nameEn: 'Chinese Style', icon: 'landmark' },
  { id: '3d_render', name: '3D渲染', nameEn: '3D Render', icon: 'box' },
  { id: 'illustration', name: '插画', nameEn: 'Illustration', icon: 'palette' },
  { id: 'retro', name: '复古', nameEn: 'Retro', icon: 'clock3' },
  { id: 'cute_q', name: 'Q萌可爱', nameEn: 'Cute & Chibi', icon: 'heart' },
  { id: 'artistic', name: '艺术风格', nameEn: 'Artistic', icon: 'pen_tool' },
  { id: 'comic', name: '漫画', nameEn: 'Comic', icon: 'message_square' },
  { id: 'pixel_game', name: '像素游戏', nameEn: 'Pixel & Game', icon: 'gamepad2' },
  { id: 'special', name: '特殊IP', nameEn: 'Special IP', icon: 'star' }
]

const STYLE_PRESETS_BASE: StylePreset[] = [
  // 日系动漫
  { id: 'cel_shading', name: '三渲二', nameEn: 'Cel Shading', category: 'japanese_anime', description: '3D渲染2D效果', prompt: 'cel shading', thumbnail: '/styles/cel_shading.webp' },
  { id: 'fujimoto_tatsuki', name: '藤本树', nameEn: 'Fujimoto', category: 'japanese_anime', description: '电锯人风格', prompt: 'Fujimoto style', thumbnail: '/styles/fujimoto_tatsuki.webp' },
  { id: 'konoha_village', name: '木叶村', nameEn: 'Konoha', category: 'japanese_anime', description: '火影风格', prompt: 'Naruto style', thumbnail: '/styles/konoha_village.webp' },
  { id: 'ghibli', name: '吉卜力', nameEn: 'Ghibli', category: 'japanese_anime', description: '宫崎骏风格', prompt: 'Ghibli style', thumbnail: '/styles/ghibli.webp' },
  { id: 'japanese_shoujo', name: '日式少女漫', nameEn: 'Shoujo', category: 'japanese_anime', description: '少女漫画', prompt: 'shoujo manga', thumbnail: '/styles/japanese_shoujo.webp' },
  { id: 'hard_edge_moe_cel', name: '硬边萌系赛璐璐', nameEn: 'Hard Edge Moe', category: 'japanese_anime', description: '硬边萌系', prompt: 'hard edge cel', thumbnail: '/styles/hard_edge_moe_cel.webp' },
  { id: 'active_moe_cel', name: '活力萌系赛璐璐', nameEn: 'Active Moe', category: 'japanese_anime', description: '活力萌系', prompt: 'active moe', thumbnail: '/styles/active_moe_cel.webp' },
  { id: 'retro_cel_nostalgic', name: '复古赛璐璐怀旧动画', nameEn: 'Retro Cel', category: 'japanese_anime', description: '80-90年代', prompt: 'retro anime', thumbnail: '/styles/retro_cel_nostalgic.webp' },
  { id: 'korean_webtoon', name: '韩式漫画厚涂', nameEn: 'Korean Webtoon', category: 'japanese_anime', description: '韩漫风格', prompt: 'Korean webtoon', thumbnail: '/styles/korean_webtoon.webp' },
  // 国风
  { id: '3d_guochuang', name: '3D国创', nameEn: '3D Chinese', category: 'chinese_style', description: '中国3D动画', prompt: 'Chinese 3D', thumbnail: '/styles/3d_guochuang.webp', isNew: true },
  { id: '2d_playlet', name: '2D叙事影视', nameEn: '2D Cinematic', category: 'chinese_style', description: '中国2D叙事影视', prompt: 'Chinese 2D', thumbnail: '/styles/2d_playlet.webp', isNew: true },
  { id: 'chinese_ink', name: '国风水墨', nameEn: 'Chinese Ink', category: 'chinese_style', description: '水墨画风格', prompt: 'Chinese ink', thumbnail: '/styles/chinese_ink.webp', isNew: true },
  { id: 'oriental_light_color', name: '东方淡彩', nameEn: 'Oriental Light', category: 'chinese_style', description: '东方淡雅', prompt: 'oriental light', thumbnail: '/styles/oriental_light_color.webp' },
  { id: 'oriental_classical_deco', name: '东方古典装饰', nameEn: 'Oriental Deco', category: 'chinese_style', description: '古典装饰', prompt: 'oriental deco', thumbnail: '/styles/oriental_classical_deco.webp' },
  { id: 'dragon_legend', name: '龙族传说', nameEn: 'Dragon Legend', category: 'chinese_style', description: '龙族题材', prompt: 'dragon legend', thumbnail: '/styles/dragon_legend.webp' },
  // 3D渲染
  { id: 'block_world', name: '方块世界', nameEn: 'Block World', category: '3d_render', description: 'Minecraft风格', prompt: 'Minecraft', thumbnail: '/styles/block_world.webp' },
  { id: 'clay_toy', name: '粘土玩具', nameEn: 'Clay Toy', category: '3d_render', description: '粘土动画', prompt: 'claymation', thumbnail: '/styles/clay_toy.webp' },
  { id: 'american_3d', name: '美式3D', nameEn: 'American 3D', category: '3d_render', description: '皮克斯风格', prompt: 'Pixar style', thumbnail: '/styles/american_3d.webp' },
  { id: 'q_version_3d', name: 'Q版3D', nameEn: 'Chibi 3D', category: '3d_render', description: 'Q版3D', prompt: 'chibi 3D', thumbnail: '/styles/q_version_3d.webp' },
  { id: 'animal_crossing', name: '动森', nameEn: 'Animal Crossing', category: '3d_render', description: '动物森友会', prompt: 'Animal Crossing', thumbnail: '/styles/animal_crossing.webp' },
  { id: 'lego', name: '乐高', nameEn: 'LEGO', category: '3d_render', description: '乐高风格', prompt: 'LEGO style', thumbnail: '/styles/lego.webp' },
  { id: 'plush_toy', name: '毛绒玩具质感', nameEn: 'Plush Toy', category: '3d_render', description: '毛绒质感', prompt: 'plush toy', thumbnail: '/styles/plush_toy.webp' },
  { id: 'origami', name: '折纸艺术', nameEn: 'Origami', category: '3d_render', description: '折纸风格', prompt: 'origami', thumbnail: '/styles/origami.webp' },
  { id: 'laika_stop_motion', name: '莱卡定格动画', nameEn: 'Laika', category: '3d_render', description: '定格动画', prompt: 'Laika style', thumbnail: '/styles/laika_stop_motion.webp' },
  { id: 'game_cg', name: '游戏CG', nameEn: 'Game CG', category: '3d_render', description: '次世代游戏CG质感', prompt: 'game cg', thumbnail: '/styles/game_cg.webp', isNew: true },
  { id: 'interactive_3d_dating', name: '3D乙游', nameEn: 'Interactive 3D Dating', category: '3d_render', description: '乙女向3D风格', prompt: 'interactive 3d dating', thumbnail: '/styles/interactive_3d_dating.webp', isNew: true },
  { id: 'live_action', name: 'AI真人', nameEn: 'Live-Action', category: '3d_render', description: '影视级写实风格', prompt: 'live action', thumbnail: '/styles/live_action.webp', isNew: true },
  { id: 'western_3d_cg', name: '欧美CG', nameEn: '3D CG', category: '3d_render', description: '欧美写实CG风格', prompt: 'western 3d cg', thumbnail: '/styles/western_3d_cg.webp', isNew: true },
  // 插画
  { id: 'healing_q_cute', name: '治愈Q萌', nameEn: 'Healing Cute', category: 'illustration', description: '治愈系', prompt: 'healing cute', thumbnail: '/styles/healing_q_cute.webp' },
  { id: 'city_romance', name: '都市言情', nameEn: 'City Romance', category: 'illustration', description: '都市恋爱叙事氛围', prompt: 'city romance', thumbnail: '/styles/city_romance.webp' },
  { id: 'warm_colorful', name: '温馨彩绘', nameEn: 'Warm Colorful', category: 'illustration', description: '温馨彩绘', prompt: 'warm colorful', thumbnail: '/styles/warm_colorful.webp' },
  { id: 'air_colored_pencil', name: '空气彩铅', nameEn: 'Air Pencil', category: 'illustration', description: '轻盈彩铅', prompt: 'air pencil', thumbnail: '/styles/air_colored_pencil.webp' },
  { id: 'light_shadow_flat', name: '光影平涂', nameEn: 'Light Flat', category: 'illustration', description: '光影平涂', prompt: 'light flat', thumbnail: '/styles/light_shadow_flat.webp' },
  { id: 'light_retro_watercolor', name: '轻复古水彩', nameEn: 'Retro Watercolor', category: 'illustration', description: '复古水彩', prompt: 'retro watercolor', thumbnail: '/styles/light_retro_watercolor.webp' },
  { id: 'fantasy_flat', name: '奇幻平涂', nameEn: 'Fantasy Flat', category: 'illustration', description: '奇幻平涂', prompt: 'fantasy flat', thumbnail: '/styles/fantasy_flat.webp' },
  { id: 'soft_light_thick_paint', name: '柔光平涂', nameEn: 'Soft Light', category: 'illustration', description: '柔光平涂', prompt: 'soft light', thumbnail: '/styles/soft_light_thick_paint.webp' },
  { id: 'transparent_thick_paint', name: '通透柔光厚涂', nameEn: 'Transparent', category: 'illustration', description: '通透厚涂', prompt: 'transparent', thumbnail: '/styles/transparent_thick_paint.webp' },
  { id: 'soft_light_original', name: '柔光原画厚涂', nameEn: 'Concept Art', category: 'illustration', description: '原画风格', prompt: 'concept art', thumbnail: '/styles/soft_light_original.webp' },
  { id: 'transparent_macaron', name: '通透光泽马卡龙', nameEn: 'Macaron', category: 'illustration', description: '马卡龙色', prompt: 'macaron', thumbnail: '/styles/transparent_macaron.webp' },
  { id: 'vector_flat_blocks', name: '矢量扁平色块', nameEn: 'Vector Flat', category: 'illustration', description: '矢量扁平', prompt: 'vector flat', thumbnail: '/styles/vector_flat_blocks.webp' },
  { id: 'simple_crayon', name: '质朴蜡笔', nameEn: 'Simple Crayon', category: 'illustration', description: '蜡笔风格', prompt: 'crayon', thumbnail: '/styles/simple_crayon.webp' },
  { id: 'rough_grain_print', name: '粗糙颗粒肌理版画', nameEn: 'Grain Print', category: 'illustration', description: '版画风格', prompt: 'grain print', thumbnail: '/styles/rough_grain_print.webp' },
  { id: 'sweet_retro_pop', name: '甜美可爱复古波普', nameEn: 'Sweet Pop', category: 'illustration', description: '复古波普', prompt: 'sweet pop', thumbnail: '/styles/sweet_retro_pop.webp' },
  { id: 'pop_print', name: '波普印刷', nameEn: 'Pop Print', category: 'illustration', description: '波普印刷', prompt: 'pop print', thumbnail: '/styles/pop_print.webp' },
  { id: 'cream_picture_book', name: '奶油色绘本', nameEn: 'Cream Book', category: 'illustration', description: '绘本风格', prompt: 'cream book', thumbnail: '/styles/cream_picture_book.webp' },
  { id: 'expressionist_child_doodle', name: '表现主义儿童涂鸦', nameEn: 'Child Doodle', category: 'illustration', description: '儿童涂鸦', prompt: 'child doodle', thumbnail: '/styles/expressionist_child_doodle.webp' },
  { id: 'colored_pencil_sketch', name: '彩铅素描插画', nameEn: 'Pencil Sketch', category: 'illustration', description: '彩铅素描', prompt: 'pencil sketch', thumbnail: '/styles/colored_pencil_sketch.webp' },
  { id: 'transparent_light_thick', name: '通透光影厚涂', nameEn: 'Light Thick', category: 'illustration', description: '光影厚涂', prompt: 'light thick', thumbnail: '/styles/transparent_light_thick.webp' },
  // 复古
  { id: 'korean_urban', name: '韩系都市', nameEn: 'Korean Urban', category: 'retro', description: '韩系都市', prompt: 'Korean urban', thumbnail: '/styles/korean_urban.webp' },
  { id: 'ethereal_gothic', name: '空灵哥特', nameEn: 'Ethereal Gothic', category: 'retro', description: '空灵哥特', prompt: 'ethereal gothic', thumbnail: '/styles/ethereal_gothic.webp' },
  { id: 'horror_suspense', name: '恐怖悬疑', nameEn: 'Horror', category: 'retro', description: '恐怖悬疑', prompt: 'horror', thumbnail: '/styles/horror_suspense.webp', isNew: true },
  { id: 'trendy_urban', name: '潮流都市', nameEn: 'Trendy Urban', category: 'retro', description: '潮流都市', prompt: 'trendy urban', thumbnail: '/styles/trendy_urban.webp' },
  { id: 'retro_handheld', name: '复古掌机', nameEn: 'Retro Handheld', category: 'retro', description: 'GameBoy风格', prompt: 'GameBoy', thumbnail: '/styles/retro_handheld.webp' },
  { id: 'etched_light', name: '蚀刻光影', nameEn: 'Etched Light', category: 'retro', description: '蚀刻版画', prompt: 'etching', thumbnail: '/styles/etched_light.webp' },
  { id: '80s_era', name: '80s年代', nameEn: '80s Era', category: 'retro', description: '80年代', prompt: '80s retro', thumbnail: '/styles/80s_era.webp' },
  { id: 'american_sitcom', name: '美式喜剧', nameEn: 'American Sitcom', category: 'retro', description: '美式喜剧', prompt: 'sitcom', thumbnail: '/styles/american_sitcom.webp' },
  { id: 'retro_colorful_light', name: '复古彩光', nameEn: 'Retro Light', category: 'retro', description: '复古彩光', prompt: 'retro light', thumbnail: '/styles/retro_colorful_light.webp' },
  { id: 'nostalgic_film_lines', name: '怀旧胶片线条', nameEn: 'Film Lines', category: 'retro', description: '胶片质感', prompt: 'film grain', thumbnail: '/styles/nostalgic_film_lines.webp' },
  { id: 'psychedelic_retro_urban', name: '迷幻复古都市', nameEn: 'Psychedelic', category: 'retro', description: '迷幻复古', prompt: 'psychedelic', thumbnail: '/styles/psychedelic_retro_urban.webp' },
  { id: 'nostalgic_film_atmosphere', name: '怀旧电影感氛围光影', nameEn: 'Film Atmosphere', category: 'retro', description: '电影感', prompt: 'cinematic', thumbnail: '/styles/nostalgic_film_atmosphere.webp' },
  { id: 'retro_japanese', name: '复古日式', nameEn: 'Retro Japanese', category: 'retro', description: '复古日式', prompt: 'retro Japanese', thumbnail: '/styles/retro_japanese.webp' },
  { id: 'retro_line_urban', name: '复古线条都市', nameEn: 'Retro Line', category: 'retro', description: '复古线条', prompt: 'retro line', thumbnail: '/styles/retro_line_urban.webp' },
  { id: '50s_era', name: '五零年代', nameEn: '50s Era', category: 'retro', description: '50年代', prompt: '1950s', thumbnail: '/styles/50s_era.webp' },
  { id: 'faded_grain_nostalgic', name: '褪色颗粒怀旧', nameEn: 'Faded Grain', category: 'retro', description: '褪色颗粒', prompt: 'faded grain', thumbnail: '/styles/faded_grain_nostalgic.webp' },
  // Q萌可爱
  { id: 'cute_macaron', name: '可爱马卡龙', nameEn: 'Cute Macaron', category: 'cute_q', description: '马卡龙色', prompt: 'macaron', thumbnail: '/styles/cute_macaron.webp' },
  { id: 'q_sketch', name: 'Q版草绘', nameEn: 'Chibi Sketch', category: 'cute_q', description: 'Q版草绘', prompt: 'chibi sketch', thumbnail: '/styles/q_sketch.webp' },
  { id: 'healing_soft_q', name: '治愈柔和Q版', nameEn: 'Healing Chibi', category: 'cute_q', description: '治愈Q版', prompt: 'healing chibi', thumbnail: '/styles/healing_soft_q.webp' },
  { id: 'morandi_q', name: '莫兰迪Q版', nameEn: 'Morandi Chibi', category: 'cute_q', description: '莫兰迪色', prompt: 'Morandi chibi', thumbnail: '/styles/morandi_q.webp' },
  { id: 'super_chibi', name: '粗线超级Q版', nameEn: 'Super Chibi', category: 'cute_q', description: '超级Q版', prompt: 'super chibi', thumbnail: '/styles/super_chibi.webp' },
  { id: 'warm_healing_q', name: '温暖治愈Q版', nameEn: 'Warm Chibi', category: 'cute_q', description: '温暖Q版', prompt: 'warm chibi', thumbnail: '/styles/warm_healing_q.webp' },
  { id: 'fresh_childlike_q', name: '清新童趣Q版', nameEn: 'Fresh Chibi', category: 'cute_q', description: '清新Q版', prompt: 'fresh chibi', thumbnail: '/styles/fresh_childlike_q.webp' },
  { id: 'sweet_pastel', name: '甜美粉彩', nameEn: 'Sweet Pastel', category: 'cute_q', description: '甜美粉彩', prompt: 'sweet pastel', thumbnail: '/styles/sweet_pastel.webp' },
  { id: 'thick_line_trendy_q', name: '粗线潮流Q版', nameEn: 'Trendy Chibi', category: 'cute_q', description: '潮流Q版', prompt: 'trendy chibi', thumbnail: '/styles/thick_line_trendy_q.webp' },
  { id: 'grain_pastel_fairy', name: '颗粒粉彩童话风', nameEn: 'Pastel Fairy', category: 'cute_q', description: '童话风', prompt: 'pastel fairy', thumbnail: '/styles/grain_pastel_fairy.webp' },
  { id: 'q_cute_marker', name: 'Q萌马克笔着色', nameEn: 'Marker Chibi', category: 'cute_q', description: '马克笔', prompt: 'marker chibi', thumbnail: '/styles/q_cute_marker.webp' },
  // 艺术风格
  { id: 'garter_girl', name: '吊带袜女孩', nameEn: 'Panty Stocking', category: 'artistic', description: '吊带袜天使', prompt: 'Panty Stocking', thumbnail: '/styles/garter_girl.webp' },
  { id: 'weird_cute_ink', name: '怪萌墨线', nameEn: 'Weird Cute Ink', category: 'artistic', description: '怪萌墨线', prompt: 'weird cute ink', thumbnail: '/styles/weird_cute_ink.webp' },
  { id: 'oil_glaze', name: '油画釉光', nameEn: 'Oil Glaze', category: 'artistic', description: '油画釉光', prompt: 'oil glaze', thumbnail: '/styles/oil_glaze.webp' },
  { id: 'low_saturation_flat', name: '低饱和平涂手绘', nameEn: 'Low Saturation', category: 'artistic', description: '低饱和', prompt: 'low saturation', thumbnail: '/styles/low_saturation_flat.webp' },
  { id: 'ethereal_realistic', name: '空灵现实', nameEn: 'Ethereal Real', category: 'artistic', description: '空灵现实', prompt: 'ethereal real', thumbnail: '/styles/ethereal_realistic.webp' },
  { id: 'american_grain', name: '美式颗粒', nameEn: 'American Grain', category: 'artistic', description: '美式颗粒', prompt: 'American grain', thumbnail: '/styles/american_grain.webp' },
  { id: 'evil_glass', name: '邪魅琉璃', nameEn: 'Evil Glass', category: 'artistic', description: '邪魅琉璃', prompt: 'evil glass', thumbnail: '/styles/evil_glass.webp' },
  { id: 'gothic_urban_graffiti', name: '哥特都市涂鸦', nameEn: 'Gothic Graffiti', category: 'artistic', description: '哥特涂鸦', prompt: 'gothic graffiti', thumbnail: '/styles/gothic_urban_graffiti.webp' },
  { id: 'renaissance_classical', name: '文艺复兴古典画', nameEn: 'Renaissance', category: 'artistic', description: '文艺复兴', prompt: 'Renaissance', thumbnail: '/styles/renaissance_classical.webp' },
  { id: 'hazy_impressionist', name: '朦胧印象派', nameEn: 'Impressionist', category: 'artistic', description: '印象派', prompt: 'impressionist', thumbnail: '/styles/hazy_impressionist.webp' },
  { id: 'ukiyo_surrealism', name: '浮世绘超现实主义', nameEn: 'Ukiyo-e', category: 'artistic', description: '浮世绘', prompt: 'ukiyo-e', thumbnail: '/styles/ukiyo_surrealism.webp' },
  { id: 'soft_romantic_watercolor', name: '柔光浪漫水彩笔触', nameEn: 'Romantic Watercolor', category: 'artistic', description: '浪漫水彩', prompt: 'romantic watercolor', thumbnail: '/styles/soft_romantic_watercolor.webp' },
  { id: 'dramatic_watercolor_blocks', name: '戏剧光影水彩色块', nameEn: 'Dramatic Watercolor', category: 'artistic', description: '戏剧水彩', prompt: 'dramatic watercolor', thumbnail: '/styles/dramatic_watercolor_blocks.webp' },
  { id: 'classical_drama_mood', name: '古典戏剧情绪光影', nameEn: 'Classical Drama', category: 'artistic', description: '古典戏剧', prompt: 'classical drama', thumbnail: '/styles/classical_drama_mood.webp' },
  { id: 'beautiful_radiant', name: '唯美柔光辐射', nameEn: 'Beautiful Radiant', category: 'artistic', description: '唯美柔光', prompt: 'beautiful radiant', thumbnail: '/styles/beautiful_radiant.webp' },
  { id: 'beautiful_fresh_transparent', name: '唯美清新通透', nameEn: 'Fresh Transparent', category: 'artistic', description: '清新通透', prompt: 'fresh transparent', thumbnail: '/styles/beautiful_fresh_transparent.webp' },
  { id: 'glowing_line_soft', name: '发光线条柔光', nameEn: 'Glowing Line', category: 'artistic', description: '发光线条', prompt: 'glowing line', thumbnail: '/styles/glowing_line_soft.webp' },
  { id: 'weird_gothic_cartoon', name: '怪诞哥特卡通', nameEn: 'Gothic Cartoon', category: 'artistic', description: '哥特卡通', prompt: 'gothic cartoon', thumbnail: '/styles/weird_gothic_cartoon.webp' },
  { id: 'flat_graphic_design', name: '扁平图形设计', nameEn: 'Flat Design', category: 'artistic', description: '扁平设计', prompt: 'flat design', thumbnail: '/styles/flat_graphic_design.webp' },
  { id: 'childlike_crayon', name: '童趣蜡笔插画', nameEn: 'Childlike Crayon', category: 'artistic', description: '童趣蜡笔', prompt: 'childlike crayon', thumbnail: '/styles/childlike_crayon.webp' },
  { id: 'cute_abstract_doodle', name: '可爱抽象涂鸦', nameEn: 'Abstract Doodle', category: 'artistic', description: '抽象涂鸦', prompt: 'abstract doodle', thumbnail: '/styles/cute_abstract_doodle.webp' },
  { id: 'morandi_gouache', name: '莫兰迪水粉手绘', nameEn: 'Morandi Gouache', category: 'artistic', description: '莫兰迪水粉', prompt: 'Morandi gouache', thumbnail: '/styles/morandi_gouache.webp' },
  { id: 'creepy_fantasy_book', name: '诡萌幻想绘本', nameEn: 'Creepy Fantasy', category: 'artistic', description: '诡萌绘本', prompt: 'creepy fantasy', thumbnail: '/styles/creepy_fantasy_book.webp' },
  { id: 'retro_faded_sketch', name: '复古褪色速写', nameEn: 'Faded Sketch', category: 'artistic', description: '褪色速写', prompt: 'faded sketch', thumbnail: '/styles/retro_faded_sketch.webp' },
  { id: 'cold_line_style', name: '冷静感线条', nameEn: 'Cold Line', category: 'artistic', description: '冷静线条', prompt: 'cold line', thumbnail: '/styles/cold_line_style.webp' },
  { id: 'childlike_sketch', name: '童趣速写', nameEn: 'Childlike Sketch', category: 'artistic', description: '童趣速写', prompt: 'childlike sketch', thumbnail: '/styles/childlike_sketch.webp' },
  { id: 'minimal_geometric', name: '极简几何艺术', nameEn: 'Minimal Geometric', category: 'artistic', description: '极简几何', prompt: 'minimal geometric', thumbnail: '/styles/minimal_geometric.webp' },
  { id: 'simple_flat_cartoon', name: '简约扁平手绘卡通', nameEn: 'Simple Flat', category: 'artistic', description: '简约扁平', prompt: 'simple flat', thumbnail: '/styles/simple_flat_cartoon.webp' },
  { id: 'mono_hatching_sketch', name: '单色排线素描', nameEn: 'Mono Hatching', category: 'artistic', description: '单色排线', prompt: 'mono hatching', thumbnail: '/styles/mono_hatching_sketch.webp' },
  { id: 'minimal_retro_pop', name: '极简色块复古波普', nameEn: 'Minimal Pop', category: 'artistic', description: '极简波普', prompt: 'minimal pop', thumbnail: '/styles/minimal_retro_pop.webp' },
  { id: 'fresh_watercolor_ink', name: '清新水彩墨线', nameEn: 'Fresh Watercolor', category: 'artistic', description: '清新水彩', prompt: 'fresh watercolor', thumbnail: '/styles/fresh_watercolor_ink.webp' },
  { id: 'healing_grain_pencil', name: '治愈童趣颗粒彩铅', nameEn: 'Healing Pencil', category: 'artistic', description: '治愈彩铅', prompt: 'healing pencil', thumbnail: '/styles/healing_grain_pencil.webp' },
  { id: 'lyrical_soft_line', name: '抒情柔光线条', nameEn: 'Lyrical Line', category: 'artistic', description: '抒情线条', prompt: 'lyrical line', thumbnail: '/styles/lyrical_soft_line.webp' },
  { id: 'rainbow_dreamy_watercolor', name: '虹彩梦幻治愈水彩', nameEn: 'Rainbow Watercolor', category: 'artistic', description: '虹彩水彩', prompt: 'rainbow watercolor', thumbnail: '/styles/rainbow_dreamy_watercolor.webp' },
  { id: 'high_contrast_graphic', name: '高对比硬边缘图形', nameEn: 'High Contrast', category: 'artistic', description: '高对比', prompt: 'high contrast', thumbnail: '/styles/high_contrast_graphic.webp' },
  { id: 'enchanting_gothic_neon', name: '魅惑哥特霓虹', nameEn: 'Gothic Neon', category: 'artistic', description: '哥特霓虹', prompt: 'gothic neon', thumbnail: '/styles/enchanting_gothic_neon.webp' },
  { id: 'vaporwave_candy_healing', name: '蒸汽波神话糖果治愈系', nameEn: 'Vaporwave', category: 'artistic', description: '蒸汽波', prompt: 'vaporwave', thumbnail: '/styles/vaporwave_candy_healing.webp' },
  { id: 'gouache_children_book', name: '水粉童书插画', nameEn: 'Gouache Book', category: 'artistic', description: '水粉童书', prompt: 'gouache book', thumbnail: '/styles/gouache_children_book.webp' },
  { id: 'urban_hard_edge_clash', name: '都市潮漫硬边撞色', nameEn: 'Urban Clash', category: 'artistic', description: '都市撞色', prompt: 'urban clash', thumbnail: '/styles/urban_hard_edge_clash.webp' },
  { id: 'retro_dreamy_cel', name: '复古梦幻赛璐璐', nameEn: 'Dreamy Cel', category: 'artistic', description: '梦幻赛璐璐', prompt: 'dreamy cel', thumbnail: '/styles/retro_dreamy_cel.webp' },
  // 漫画
  { id: 'cartoon_flat', name: '卡通平涂漫画', nameEn: 'Cartoon Flat', category: 'comic', description: '卡通平涂', prompt: 'cartoon flat', thumbnail: '/styles/cartoon_flat.webp' },
  { id: 'shoujo_dream', name: '女频漫画', nameEn: 'Shoujo Dream', category: 'comic', description: '少女向叙事漫画', prompt: 'shoujo dream', thumbnail: '/styles/shoujo_dream.webp' },
  { id: 'rough_ink_line', name: '粗犷墨线', nameEn: 'Rough Ink', category: 'comic', description: '粗犷墨线', prompt: 'rough ink', thumbnail: '/styles/rough_ink_line.webp' },
  { id: 'charcoal_dark_punk', name: '炭笔暗黑朋克', nameEn: 'Dark Punk', category: 'comic', description: '暗黑朋克', prompt: 'dark punk', thumbnail: '/styles/charcoal_dark_punk.webp' },
  { id: 'euro_concept_art', name: '欧漫概念艺术', nameEn: 'Euro Concept', category: 'comic', description: '欧漫概念', prompt: 'euro concept', thumbnail: '/styles/euro_concept_art.webp' },
  { id: 'american_thick_line', name: '美式粗线漫画', nameEn: 'American Comic', category: 'comic', description: '美式漫画', prompt: 'American comic', thumbnail: '/styles/american_thick_line.webp' },
  { id: 'american_muscle_satire', name: '美式肌肉讽刺卡通', nameEn: 'Muscle Satire', category: 'comic', description: '肌肉讽刺', prompt: 'muscle satire', thumbnail: '/styles/american_muscle_satire.webp' },
  { id: 'classic_american_comic', name: '经典美式漫画', nameEn: 'Classic Comic', category: 'comic', description: '经典美漫', prompt: 'classic comic', thumbnail: '/styles/classic_american_comic.webp' },
  { id: 'complex_line_urban', name: '复杂线条都市漫', nameEn: 'Complex Line', category: 'comic', description: '复杂线条', prompt: 'complex line', thumbnail: '/styles/complex_line_urban.webp' },
  { id: 'healing_adventure_comic', name: '治愈冒险漫画', nameEn: 'Healing Adventure', category: 'comic', description: '治愈冒险', prompt: 'healing adventure', thumbnail: '/styles/healing_adventure_comic.webp' },
  { id: 'ink_line_cartoon', name: '墨线卡通', nameEn: 'Ink Cartoon', category: 'comic', description: '墨线卡通', prompt: 'ink cartoon', thumbnail: '/styles/ink_line_cartoon.webp' },
  { id: 'thick_line_dynamic', name: '粗线活力动感卡通', nameEn: 'Dynamic Cartoon', category: 'comic', description: '动感卡通', prompt: 'dynamic cartoon', thumbnail: '/styles/thick_line_dynamic.webp' },
  { id: 'high_energy_dynamic', name: '高能动感卡通', nameEn: 'High Energy', category: 'comic', description: '高能动感', prompt: 'high energy', thumbnail: '/styles/high_energy_dynamic.webp' },
  { id: 'thick_block_cartoon', name: '粗线块面卡通', nameEn: 'Block Cartoon', category: 'comic', description: '块面卡通', prompt: 'block cartoon', thumbnail: '/styles/thick_block_cartoon.webp' },
  { id: 'soft_light_thick_cartoon', name: '柔和光影厚涂卡通', nameEn: 'Soft Cartoon', category: 'comic', description: '柔和厚涂', prompt: 'soft cartoon', thumbnail: '/styles/soft_light_thick_cartoon.webp' },
  { id: 'hazy_warm_sketch', name: '朦胧暖色速写', nameEn: 'Hazy Sketch', category: 'comic', description: '朦胧速写', prompt: 'hazy sketch', thumbnail: '/styles/hazy_warm_sketch.webp' },
  { id: 'rough_hard_edge_cel', name: '粗犷硬边赛璐璐', nameEn: 'Hard Edge Cel', category: 'comic', description: '硬边赛璐璐', prompt: 'hard edge cel', thumbnail: '/styles/rough_hard_edge_cel.webp' },
  { id: 'flat_doodle', name: '扁平涂鸦', nameEn: 'Flat Doodle', category: 'comic', description: '扁平涂鸦', prompt: 'flat doodle', thumbnail: '/styles/flat_doodle.webp' },
  { id: 'thick_soft_nostalgic', name: '厚涂柔光怀旧', nameEn: 'Soft Nostalgic', category: 'comic', description: '柔光怀旧', prompt: 'soft nostalgic', thumbnail: '/styles/thick_soft_nostalgic.webp' },
  { id: 'colorful_hatching', name: '彩色排线手绘', nameEn: 'Colorful Hatching', category: 'comic', description: '彩色排线', prompt: 'colorful hatching', thumbnail: '/styles/colorful_hatching.webp' },
  { id: 'dreamy_line_weird', name: '梦幻线条怪诞', nameEn: 'Dreamy Weird', category: 'comic', description: '梦幻怪诞', prompt: 'dreamy weird', thumbnail: '/styles/dreamy_line_weird.webp' },
  { id: 'vivid_watercolor_graphic', name: '生动水彩图形', nameEn: 'Vivid Watercolor', category: 'comic', description: '生动水彩', prompt: 'vivid watercolor', thumbnail: '/styles/vivid_watercolor_graphic.webp' },
  // 像素游戏
  { id: 'pixel', name: '像素', nameEn: 'Pixel Art', category: 'pixel_game', description: '像素艺术', prompt: 'pixel art', thumbnail: '/styles/pixel.webp' },
  { id: 'raster_pixel_art', name: '光栅像素艺术', nameEn: 'Raster Pixel', category: 'pixel_game', description: '光栅像素', prompt: 'raster pixel', thumbnail: '/styles/raster_pixel_art.webp' },
  { id: 'rusty_lake', name: '锈湖', nameEn: 'Rusty Lake', category: 'pixel_game', description: '锈湖风格', prompt: 'Rusty Lake', thumbnail: '/styles/rusty_lake.webp' },
  { id: 'prism_glitch', name: '棱镜故障艺术', nameEn: 'Prism Glitch', category: 'pixel_game', description: '故障艺术', prompt: 'prism glitch', thumbnail: '/styles/prism_glitch.webp' },
  { id: 'stylized_cyber', name: '风格化撞色赛博', nameEn: 'Stylized Cyber', category: 'pixel_game', description: '赛博朋克', prompt: 'stylized cyber', thumbnail: '/styles/stylized_cyber.webp' },
  // 特殊IP
  { id: 'detective_anan', name: '名侦探阿楠', nameEn: 'Detective', category: 'special', description: '柯南风格', prompt: 'Detective Conan', thumbnail: '/styles/detective_anan.webp' },
  { id: 'vicecity_game', name: '给他爱', nameEn: 'Vicecity Game', category: 'special', description: '美式开放世界IP风格', prompt: 'vicecity game', thumbnail: '/styles/vicecity_game.webp', isNew: true },
  { id: 'eternal_journey', name: '辛逝季-芙莉莲', nameEn: 'Eternal Journey', category: 'special', description: '日系治愈冒险IP风格', prompt: 'eternal journey', thumbnail: '/styles/eternal_journey.webp' },
  { id: 'south_park', name: '南方公园', nameEn: 'South Park', category: 'special', description: '美式讽刺动画IP风格', prompt: 'south park', thumbnail: '/styles/south_park.webp' },
  { id: 'bizarre_contour', name: 'JoJo', nameEn: 'Bizarre Contour', category: 'special', description: '热血漫画IP风格', prompt: 'bizarre contour', thumbnail: '/styles/bizarre_contour.webp' },
  { id: 'springfield_yellow', name: '辛普森', nameEn: 'Springfield Yellow', category: 'special', description: '经典美式家庭动画风格', prompt: 'springfield yellow', thumbnail: '/styles/springfield_yellow.webp' },
  { id: 'spirit_samurai', name: '尸魂界-死神', nameEn: 'Spirit Samurai', category: 'special', description: '和风热血战斗IP风格', prompt: 'spirit samurai', thumbnail: '/styles/spirit_samurai.webp' },
  { id: 'snoopy', name: '史努比', nameEn: 'Snoopy', category: 'special', description: '史努比', prompt: 'Snoopy', thumbnail: '/styles/snoopy.webp' },
  { id: 'straw_hat_crew', name: '草帽团', nameEn: 'Straw Hat', category: 'special', description: '海贼王', prompt: 'One Piece', thumbnail: '/styles/straw_hat_crew.webp' },
  { id: 'crayon_shinchan', name: '蜡笔小新', nameEn: 'Shin-chan', category: 'special', description: '蜡笔小新', prompt: 'Shin-chan', thumbnail: '/styles/crayon_shinchan.webp' },
  { id: 'bikini_bottom', name: '比奇堡', nameEn: 'Bikini Bottom', category: 'special', description: '海绵宝宝', prompt: 'SpongeBob', thumbnail: '/styles/bikini_bottom.webp' },
  { id: 'stick_figure', name: '火柴人', nameEn: 'Stick Figure', category: 'special', description: '火柴人', prompt: 'stick figure', thumbnail: '/styles/stick_figure.webp' },
  { id: 'japanese_chibi', name: '日本小人', nameEn: 'Japanese Chibi', category: 'special', description: '日本小人', prompt: 'Japanese chibi', thumbnail: '/styles/japanese_chibi.webp' }
]

export const STYLE_PRESETS: StylePreset[] = STYLE_PRESETS_BASE.map(style => ({
  ...style,
  description: STYLE_DESCRIPTION_OVERRIDES[style.id] || style.description
}))

export function getStylesByCategory(category: StyleCategory): StylePreset[] {
  return STYLE_PRESETS.filter(style => style.category === category)
}

export function getStyleById(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find(style => style.id === id)
}

export function searchStyles(query: string): StylePreset[] {
  const q = query.toLowerCase()
  return STYLE_PRESETS.filter(s => s.name.includes(q) || s.nameEn.toLowerCase().includes(q) || s.description.includes(q))
}

export function getNewStyles(): StylePreset[] {
  return STYLE_PRESETS.filter(style => style.isNew)
}
