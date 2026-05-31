-- Preserve the linked English PI number for Chinese PIs after the English row is deleted.
ALTER TABLE pi ADD COLUMN linkedPiNoSnapshot TEXT;

UPDATE pi
SET linkedPiNoSnapshot = (
  SELECT linked.piNo
  FROM pi AS linked
  WHERE linked.id = pi.linkedPiId
)
WHERE language = 'ZH'
  AND linkedPiId IS NOT NULL
  AND linkedPiNoSnapshot IS NULL;
