import type { Allergen, Dietary, Unit } from '@rit/shared'

/**
 * Static Spanish for everything that is an *enum* in the domain: allergen and
 * dietary labels, units, and the reader's own chrome. Deliberately not
 * machine-translated — a fixed dictionary is deterministic, reviewable in one
 * place, and means the LLM never touches safety vocabulary. The LLM only ever
 * translates free text (names, descriptions, ingredient lines, steps).
 *
 * Terms favour the widely understood Latin American kitchen register.
 */

export const allergenEs: Record<Allergen, string> = {
  milk: 'lácteos',
  eggs: 'huevo',
  fish: 'pescado',
  shellfish: 'mariscos',
  tree_nuts: 'frutos secos',
  peanuts: 'cacahuate',
  wheat: 'trigo',
  soybeans: 'soya',
  sesame: 'ajonjolí',
  gluten: 'gluten',
  mustard: 'mostaza',
  celery: 'apio',
  sulphites: 'sulfitos',
  lupin: 'altramuz',
  molluscs: 'moluscos',
  alcohol: 'alcohol',
  pork: 'cerdo',
}

export const dietaryEs: Record<Dietary, string> = {
  vegetarian: 'vegetariano',
  vegan: 'vegano',
  pescatarian: 'pescetariano',
  gluten_free: 'sin gluten',
  dairy_free: 'sin lácteos',
  nut_free: 'sin frutos secos',
  halal: 'halal',
  kosher: 'kosher',
  keto: 'keto',
  low_sodium: 'bajo en sodio',
}

/** Kitchen-standard unit abbreviations. Metric symbols stay as-is. */
export const unitEs: Record<Unit, string> = {
  g: 'g',
  kg: 'kg',
  oz: 'oz',
  lb: 'lb',
  ml: 'ml',
  l: 'l',
  tsp: 'cdta',
  tbsp: 'cda',
  floz: 'oz fl',
  cup: 'taza',
  pt: 'pinta',
  qt: 'cuarto',
  gal: 'galón',
  each: 'pza',
  case: 'caja',
  bunch: 'manojo',
  clove: 'diente',
  can: 'lata',
  pkg: 'paq',
}

/** The reader's own chrome, in Spanish. */
export const readerEs = {
  ingredients: 'Ingredientes',
  method: 'Preparación',
  allergens: 'Alérgenos',
  dietary: 'Dieta',
  yield: 'Rinde',
  prep: 'Prep',
  cook: 'Cocción',
  live: 'en uso',
  noIngredients: 'Sin ingredientes.',
  noSteps: 'Sin pasos.',
  noVerifiedAllergens: 'Sin alérgenos verificados.',
  openSubRecipe: 'Abrir',
  aiAssisted: 'Traducción aprobada · asistida por IA',
  /**
   * SAFETY: shown instead of `aiAssisted` when the org publishes machine
   * translations without review. Staff must know no one checked this text
   * before deciding to act on it.
   */
  aiUnreviewed: 'Traducción automática · sin revisar',
  unreviewedWarning:
    'Esta traducción la hizo una máquina y nadie la ha revisado. Si algo no cuadra con el original en inglés, confía en el inglés y pregunta a un chef.',
  allergenWarning:
    'La información de alérgenos de esta receta no está completamente verificada. No respondas preguntas de alérgenos con ella — pregunta a un chef.',
} as const
