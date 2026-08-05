import type { Request, Response } from 'express';
import type {
  ApproveAllergensInput,
  CreateRecipeInput,
  ForkRecipeInput,
  ListRecipesQuery,
  SaveVersionInput,
  UpdateRecipeInput,
} from '@rit/shared';
import * as recipeService from './recipe.service';
import { pathParam } from '../../lib/params';

export async function listRecipes(req: Request, res: Response): Promise<void> {
  const recipes = await recipeService.listRecipes(
    req.tenant!,
    req.validatedQuery as ListRecipesQuery
  );
  res.status(200).json(recipes);
}

export async function createRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.createRecipe(
    req.tenant!,
    req.userId!,
    req.body as CreateRecipeInput
  );
  res.status(201).json(recipe);
}

export async function getRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.getRecipe(req.tenant!, pathParam(req, 'id'));
  res.status(200).json(recipe);
}

export async function updateRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.updateRecipe(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id'),
    req.body as UpdateRecipeInput
  );
  res.status(200).json(recipe);
}

export async function archiveRecipe(req: Request, res: Response): Promise<void> {
  await recipeService.archiveRecipe(req.tenant!, pathParam(req, 'id'));
  res.status(204).send();
}

export async function unarchiveRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.unarchiveRecipe(req.tenant!, pathParam(req, 'id'));
  res.status(200).json(recipe);
}

export async function listVersions(req: Request, res: Response): Promise<void> {
  const versions = await recipeService.listVersions(req.tenant!, pathParam(req, 'id'));
  res.status(200).json(versions);
}

export async function saveVersion(req: Request, res: Response): Promise<void> {
  const version = await recipeService.saveVersion(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id'),
    req.body as SaveVersionInput
  );
  res.status(201).json(version);
}

export async function getVersion(req: Request, res: Response): Promise<void> {
  const version = await recipeService.getVersion(
    req.tenant!,
    pathParam(req, 'id'),
    pathParam(req, 'versionId')
  );
  res.status(200).json(version);
}

export async function activateVersion(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.activateVersion(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id'),
    pathParam(req, 'versionId')
  );
  res.status(200).json(recipe);
}

export async function deactivateRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.deactivateRecipe(req.tenant!, pathParam(req, 'id'));
  res.status(200).json(recipe);
}

export async function restoreVersion(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.restoreVersion(
    req.tenant!,
    pathParam(req, 'id'),
    pathParam(req, 'versionId')
  );
  res.status(200).json(recipe);
}

export async function forkRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.forkRecipe(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id'),
    req.body as ForkRecipeInput
  );
  res.status(201).json(recipe);
}

export async function approveAllergens(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.approveAllergens(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id'),
    req.body as ApproveAllergensInput
  );
  res.status(200).json(recipe);
}
