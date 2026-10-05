UPDATE "TddLoop"
SET "createdAt" = "startedAt"
WHERE typeof("startedAt") = 'text'
  AND typeof("createdAt") = 'text'
  AND length("createdAt") = 19
  AND substr("createdAt", 11, 1) = ' '
  AND julianday("startedAt") < julianday("createdAt");
