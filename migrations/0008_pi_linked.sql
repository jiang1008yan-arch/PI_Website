-- 需求1: one-step EN->ZH linked PI pair. Each PI may point at its linked
-- counterpart (EN <-> ZH) via linkedPiId. Nullable; standalone PIs leave it NULL.
ALTER TABLE pi ADD COLUMN linkedPiId TEXT;
