-- 需求1: system-generated mapKey on ZH productFields links a ZH field to its
-- EN counterpart for the one-time EN->ZH line-item seeding. Nullable; fields
-- without a mapKey keep the ZH default during generation.
ALTER TABLE productFields ADD COLUMN mapKey TEXT;
