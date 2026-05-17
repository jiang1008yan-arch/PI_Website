-- Keeps PI sequence numbers independent from retained PI rows so old PIs can
-- be hard-deleted without reusing sequence numbers for the same date.

CREATE TABLE piNumberSequences (
  date TEXT PRIMARY KEY,
  lastSeq INTEGER NOT NULL
);

INSERT INTO piNumberSequences (date, lastSeq)
  SELECT date, MAX(seq)
  FROM pi
  GROUP BY date;
