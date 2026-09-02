import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { DEFAULT_PROMPTS } from '../constants/defaultCatalog';
import { createPromptSchema, updatePromptSchema, CreatePromptInput, UpdatePromptInput } from '../validators/catalog';

const router = Router();
const PROMPT_TYPE = 'prompt';

function readPromptState(category: string | null) {
  if (!category) return { category: 'General', isActive: true };
  const match = category.match(/^(.*?)(?:\s*\[(active|inactive)\])?$/);
  return {
    category: match?.[1]?.trim() || 'General',
    isActive: match?.[2] !== 'inactive',
  };
}

function writePromptCategory(category: string, isActive: boolean) {
  return `${category.trim() || 'General'} [${isActive ? 'active' : 'inactive'}]`;
}

function mapPrompt(template: { id: string; name: string; category: string | null; content: string }) {
  const state = readPromptState(template.category);
  return {
    id: template.id,
    name: template.name,
    category: state.category,
    content: template.content,
    isActive: state.isActive,
  };
}

async function ensureDefaultPrompts(businessId: string) {
  const count = await prisma.template.count({ where: { businessId, type: PROMPT_TYPE } });
  if (count > 0) return;

  await prisma.template.createMany({
    data: DEFAULT_PROMPTS.map((prompt) => ({
      businessId,
      name: prompt.name,
      description: null,
      type: PROMPT_TYPE,
      content: prompt.content,
      category: writePromptCategory(prompt.category, prompt.isActive),
    })),
  });
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    await ensureDefaultPrompts(businessId);
    const prompts = await prisma.template.findMany({
      where: { businessId, type: PROMPT_TYPE },
      orderBy: { name: 'asc' },
    });
    res.json(prompts.map(mapPrompt));
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createPromptSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as CreatePromptInput;
    const prompt = await prisma.template.create({
      data: {
        businessId: req.auth!.businessId,
        name: data.name,
        type: PROMPT_TYPE,
        content: data.content,
        category: writePromptCategory(data.category, data.isActive),
      },
    });
    res.status(201).json(mapPrompt(prompt));
  })
);

router.put(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updatePromptSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as UpdatePromptInput;
    const existing = await prisma.template.findFirst({
      where: { id: String(req.params.id), businessId: req.auth!.businessId, type: PROMPT_TYPE },
    });
    if (!existing) throw new AppError(404, 'Prompt no encontrado');

    const state = readPromptState(existing.category);
    const prompt = await prisma.template.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.category !== undefined || data.isActive !== undefined
          ? { category: writePromptCategory(data.category ?? state.category, data.isActive ?? state.isActive) }
          : {}),
      },
    });
    res.json(mapPrompt(prompt));
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.template.findFirst({
      where: { id: String(req.params.id), businessId: req.auth!.businessId, type: PROMPT_TYPE },
    });
    if (!existing) throw new AppError(404, 'Prompt no encontrado');

    await prisma.template.delete({ where: { id: existing.id } });
    res.json({ success: true });
  })
);

export { router as promptsRouter };
