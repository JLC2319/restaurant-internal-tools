import { Schema } from 'mongoose';
import {
  DEFAULT_TRANSLATION_PUBLISH_MODE,
  NEW_ORG_RECIPE_PUBLISH_MODE,
  recipePublishModeValues,
  translationPublishModeValues,
} from '@rit/shared';
import type { ITenantSettings, ITenantSettingsOverride } from '../../types/index';

/**
 * The `settings` sub-document embedded on every tier of the tenant tree.
 *
 * Two shapes, one field list. The org holds concrete values because it is the
 * root of resolution — `resolveTranslationPublishMode` always needs a floor to
 * land on. Properties and locations hold *overrides*, where `null` means
 * "inherit from the parent"; that is why the override default is `null` rather
 * than the org's default, which would silently pin every child to `manual` the
 * moment it was created and make the org setting unchangeable in effect.
 *
 * Adding a setting means adding one field to each schema below and one to
 * `ITenantSettings` / `ITenantSettingsOverride`. Keep the two in step.
 */

export const orgSettingsSchema = new Schema<ITenantSettings>(
  {
    translationPublishMode: {
      type: String,
      enum: translationPublishModeValues,
      // Orgs that predate this field must keep the behaviour they already
      // have: translating is a deliberate act until someone says otherwise.
      default: DEFAULT_TRANSLATION_PUBLISH_MODE,
    },
    trainingTranslationPublishMode: {
      type: String,
      enum: translationPublishModeValues,
      // Independent of the recipe setting on purpose: an org may want Spanish
      // recipes immediately but a human review on training material.
      default: DEFAULT_TRANSLATION_PUBLISH_MODE,
    },
    recipePublishMode: {
      type: String,
      enum: recipePublishModeValues,
      // Note this default is NOT `DEFAULT_RECIPE_PUBLISH_MODE`, and the split is
      // deliberate. A Mongoose default only applies to documents created from
      // now on, so stamping `publish_on_save` here hands the shortcut to new
      // orgs — the ones onboarding a whole recipe book — while orgs that
      // predate the field store nothing and resolve to `manual` through
      // `shapeSettings`, keeping the flow their chefs already know.
      default: NEW_ORG_RECIPE_PUBLISH_MODE,
    },
  },
  { _id: false },
);

export const settingsOverrideSchema = new Schema<ITenantSettingsOverride>(
  {
    translationPublishMode: {
      type: String,
      enum: [...translationPublishModeValues, null],
      default: null,
    },
    trainingTranslationPublishMode: {
      type: String,
      enum: [...translationPublishModeValues, null],
      default: null,
    },
    recipePublishMode: {
      type: String,
      enum: [...recipePublishModeValues, null],
      default: null,
    },
  },
  { _id: false },
);
