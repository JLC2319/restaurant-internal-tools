import type { Request, Response } from 'express';
import type { TranslationLocaleInput, UpdateTranslationInput } from '@rit/shared';
import * as translationService from './translation.service';
import { pathParam } from '../../lib/params';

export async function getTranslationState(req: Request, res: Response): Promise<void> {
  const state = await translationService.getTranslationState(
    req.tenant!,
    pathParam(req, 'recipeId'),
    (req.validatedQuery as TranslationLocaleInput).locale
  );
  res.status(200).json(state);
}

export async function requestTranslation(req: Request, res: Response): Promise<void> {
  const translation = await translationService.requestTranslation(
    req.tenant!,
    req.userId!,
    pathParam(req, 'recipeId'),
    (req.body as TranslationLocaleInput).locale
  );
  res.status(200).json(translation);
}

export async function updateTranslation(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateTranslationInput;
  const translation = await translationService.updateTranslation(
    req.tenant!,
    pathParam(req, 'recipeId'),
    input.locale,
    input.payload
  );
  res.status(200).json(translation);
}

export async function approveTranslation(req: Request, res: Response): Promise<void> {
  const translation = await translationService.approveTranslation(
    req.tenant!,
    req.userId!,
    pathParam(req, 'recipeId'),
    (req.body as TranslationLocaleInput).locale
  );
  res.status(200).json(translation);
}

export async function rejectTranslation(req: Request, res: Response): Promise<void> {
  const translation = await translationService.rejectTranslation(
    req.tenant!,
    pathParam(req, 'recipeId'),
    (req.body as TranslationLocaleInput).locale
  );
  res.status(200).json(translation);
}
