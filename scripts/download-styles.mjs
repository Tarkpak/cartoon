import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE_URL = 'https://static-oiioii-sg.hogiai.cn/style_recommends'

const STYLES = {
  cel_shading: 'novelstyle1103old04.webp',
  fujimoto_tatsuki: 'novelstyle1103old01.webp',
  konoha_village: 'logo1105gengxin02.webp',
  ghibli: 'novelstyle1103old03.webp',
  '3d_guochuang': 'xianxiafantasy1208.webp',
  '2d_manju': '2DChineseAnimation.webp',
  block_world: 'logo1105gengxin03.webp',
  healing_q_cute: 'style1103new2.webp',
  korean_urban: 'kDramaaesthetic1208.webp',
  clay_toy: 'style1103new4.webp',
  garter_girl: 'style1103new5.webp',
  ethereal_gothic: 'style1103new6.webp',
  weird_cute_ink: 'novelstyle1103old05.webp',
  oil_glaze: 'novelstyle1103old06.webp',
  american_3d: 'style1103new8.webp',
  warm_colorful: 'style1103new7.webp',
  horror_suspense: 'HorrorSuspense1208.webp',
  trendy_urban: 'style1103new10.webp',
  low_saturation_flat: 'novelstyle1103old07.webp',
  chinese_ink: 'guofengink1208.webp',
  retro_handheld: 'style1103new12.webp',
  etched_light: 'novelstyle1103old08.webp',
  '80s_era': 'style1103new90.webp',
  detective_anan: 'logo1107gengxin01.webp',
  american_sitcom: 'style1103new11.webp',
  cute_macaron: 'style1103new13.webp',
  q_sketch: 'novelstyle1103old09.webp',
  ethereal_realistic: 'style1103new14.webp',
  q_version_3d: 'style1103new15.webp',
  soft_light_thick_paint: 'novelstyle1103old10.webp',
  american_grain: 'novelstyle1103old11.webp',
  evil_glass: 'novelstyle1103old12.webp',
  pixel: 'style1103new66.webp',
  retro_colorful_light: 'novelstyle1103old13.webp',
  gothic_urban_graffiti: 'novelstyle1103old14.webp',
  morandi_q: 'novelstyle1103old15.webp',
  straw_hat_crew: 'logo1105gengxin05.webp',
  animal_crossing: 'logo1105gengxin08.webp',
  lego: 'logo1105gengxin09.webp',
  hazy_warm_sketch: 'style1103new23.webp',
  rough_hard_edge_cel: 'novelstyle1103old16.webp',
  flat_doodle: 'novelstyle1103old17.webp',
  healing_soft_q: 'novelstyle1103old18.webp',
  thick_soft_nostalgic: 'novelstyle1103old19.webp',
  colorful_hatching: 'novelstyle1103old20.webp',
  bikini_bottom: 'style1103new26.webp',
  nostalgic_film_lines: 'novelstyle1103old21.webp',
  psychedelic_retro_urban: 'novelstyle1103old22.webp',
  raster_pixel_art: 'novelstyle1103old23.webp',
  cold_line_style: 'novelstyle1103old24.webp',
  thick_block_cartoon: 'novelstyle1103old25.webp',
  complex_line_urban: 'novelstyle1103old26.webp',
  transparent_thick_paint: 'novelstyle1103old27.webp',
}

const STYLES2 = {
  weird_gothic_cartoon: 'style1103new30.webp',
  flat_graphic_design: 'style1103new29.webp',
  childlike_crayon: 'style1103new31.webp',
  cute_abstract_doodle: 'style1103new32.webp',
  morandi_gouache: 'novelstyle1103old29.webp',
  japanese_chibi: 'logo1105gengxin10.webp',
  creepy_fantasy_book: 'style1103new35.webp',
  crayon_shinchan: 'logo1105gengxin06.webp',
  dragon_legend: 'logo1105gengxin01.webp',
  stick_figure: 'style1103new37.webp',
  fresh_childlike_q: 'novelstyle1103old31.webp',
  retro_faded_sketch: 'novelstyle1103old32.webp',
  sweet_pastel: 'novelstyle1103old33.webp',
  rough_ink_line: 'novelstyle1103old34.webp',
  charcoal_dark_punk: 'style1103new39.webp',
  euro_concept_art: 'style1103new40.webp',
  retro_dreamy_cel: 'novelstyle1103old35.webp',
  transparent_light_thick: 'novelstyle1103old36.webp',
  american_thick_line: 'novelstyle1103old37.webp',
  enchanting_gothic_neon: 'novelstyle1103old38.webp',
  vaporwave_candy_healing: 'style1103new44.webp',
  gouache_children_book: 'style1103new46.webp',
  urban_hard_edge_clash: 'style1103new47.webp',
  ukiyo_surrealism: 'style1103new49.webp',
  soft_romantic_watercolor: 'style1103new48.webp',
  healing_adventure_comic: 'style1103new50.webp',
  japanese_shoujo: 'style1103new51.webp',
  plush_toy: 'style1103new52.webp',
  air_colored_pencil: 'style1103new54.webp',
  light_shadow_flat: 'style1103new56.webp',
  light_retro_watercolor: 'novelstyle1103old39.webp',
  cartoon_flat: 'novelstyle1103old40.webp',
  oriental_light_color: 'style1103new57.webp',
  dramatic_watercolor_blocks: 'style1103new58.webp',
  fantasy_flat: 'style1103new59.webp',
  snoopy: 'logo1105gengxin07.webp',
  healing_grain_pencil: 'style1103new62.webp',
  thick_line_trendy_q: 'style1103new63.webp',
  grain_pastel_fairy: 'style1103new100.webp',
  lyrical_soft_line: 'style1103new64.webp',
  renaissance_classical: 'style1103new67.webp',
  hazy_impressionist: 'style1103new69.webp',
  vector_flat_blocks: 'style1103new70.webp',
  simple_crayon: 'style1103new71.webp',
  rough_grain_print: 'style1103new72.webp',
  sweet_retro_pop: 'style1103new99.webp',
  pop_print: 'style1103new73.webp',
  cream_picture_book: 'novelstyle1103old41.webp',
  expressionist_child_doodle: 'style1103new75.webp',
  classical_drama_mood: 'style1103new79.webp',
  '50s_era': 'style1103new78.webp',
  colored_pencil_sketch: 'style1103new81.webp',
  warm_healing_q: 'style1103new83.webp',
  laika_stop_motion: 'logo1105gengxin04.webp',
  rusty_lake: 'style1103new84.webp',
}

const STYLES3 = {
  nostalgic_film_atmosphere: 'novelstyle1103old42.webp',
  ink_line_cartoon: 'novelstyle1103old43.webp',
  thick_line_dynamic: 'novelstyle1103old44.webp',
  rainbow_dreamy_watercolor: 'style1103new86.webp',
  childlike_sketch: 'style1103new87.webp',
  retro_japanese: 'style1103new89.webp',
  retro_line_urban: 'novelstyle1103old45.webp',
  hard_edge_moe_cel: 'novelstyle1103old46.webp',
  minimal_geometric: 'style1103new95.webp',
  oriental_classical_deco: 'style1103new94.webp',
  origami: 'style1103new96.webp',
  super_chibi: 'style1103new98.webp',
  active_moe_cel: 'q8yh1pfydrk.webp',
  high_contrast_graphic: 'novelstyle1103old47.webp',
  soft_light_thick_cartoon: 'novelstyle1103old48.webp',
  prism_glitch: 'novelstyle1103old49.webp',
  high_energy_dynamic: 'novelstyle1103old51.webp',
  beautiful_radiant: 'novelstyle1103old52.webp',
  beautiful_fresh_transparent: 'novelstyle1103old53.webp',
  dreamy_line_weird: 'novelstyle1103old54.webp',
  glowing_line_soft: 'novelstyle1103old55.webp',
  vivid_watercolor_graphic: 'novelstyle1103old56.webp',
  soft_light_original: 'novelstyle1103old57.webp',
  transparent_macaron: 'novelstyle1103old58.webp',
  retro_cel_nostalgic: 'novelstyle1103old59.webp',
  simple_flat_cartoon: 'novelstyle1103old60.webp',
  mono_hatching_sketch: 'novelstyle1103old61.webp',
  stylized_cyber: 'novelstyle1103old63.webp',
  minimal_retro_pop: 'novelstyle1103old64.webp',
  american_muscle_satire: 'novelstyle1103old65.webp',
  classic_american_comic: 'novelstyle1103old66.webp',
  korean_webtoon: 'novelstyle1103old67.webp',
  fresh_watercolor_ink: 'novelstyle1103old68.webp',
  q_cute_marker: 'novelstyle1103old69.webp',
  faded_grain_nostalgic: 'novelstyle1103old71.webp',
}

const ALL_STYLES = { ...STYLES, ...STYLES2, ...STYLES3 }

const outputDir = 'public/styles'
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true })
}

async function downloadImage(id, filename) {
  const url = `${BASE_URL}/${filename}`
  const outputPath = join(outputDir, `${id}.webp`)
  
  if (existsSync(outputPath)) {
    console.log(`Skip ${id} (exists)`)
    return
  }
  
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    writeFileSync(outputPath, Buffer.from(buffer))
    console.log(`Downloaded ${id}`)
  } catch (err) {
    console.error(`Failed ${id}: ${err.message}`)
  }
}

async function main() {
  const entries = Object.entries(ALL_STYLES)
  console.log(`Downloading ${entries.length} images...`)
  
  // Download in batches of 10
  for (let i = 0; i < entries.length; i += 10) {
    const batch = entries.slice(i, i + 10)
    await Promise.all(batch.map(([id, filename]) => downloadImage(id, filename)))
  }
  
  console.log('Done!')
}

main()
