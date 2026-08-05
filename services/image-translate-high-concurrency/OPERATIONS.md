# Image translation candidate operations

This service uses a single-node durable SQLite queue. It is designed to absorb
bounded bursts safely on the current host and to resume interrupted work after
a process restart. It is not a distributed queue: do not run multiple service
replicas against separate copies of `tasks.db`.

## Runtime defaults

- One image worker (`IMAGE_TRANSLATE_WORKERS=1`).
- At most 120 queued/processing images.
- At most three active tasks per user.
- Three attempts for retryable storage or unexpected failures.
- Exponential retry backoff starting at five seconds.
- Ninety seconds per image as the wait estimate until measured data is
  available.
- WAL mode, transactional claims, task-level ordering within user-level fair
  scheduling, and startup recovery of interrupted items.

The current 2-core, 3.5 GB host must stay at one worker until a measured load
test proves that a second OCR/vision pipeline fits without memory pressure.
Horizontal scale requires moving the queue to PostgreSQL or Redis first.

## Quality behavior

- Horizontal Chinese remains horizontal.
- Approved vertical Malay layout is preserved when the source-side safe area
  remains clear; alternate placement is used only on detected collisions.
- Overlapping horizontal rows of the same style are merged; different-colour
  header/body rows retain their styles and are split into non-overlapping boxes.
- Non-Chinese package copy is not translated or erased.
- Unsafe translated-region overlap and out-of-bounds layout fail closed.
- Low-confidence source cleanup continues through downstream repair and is
  emitted as a downloadable `needs_review` result only when final OCR is clean.
- Residual Chinese is checked on the exact 800x800 public artifact and consumes
  the durable retry budget before becoming a terminal failure.
- Seller watermarks that cross detected product foreground are rejected with a
  manual-processing reason. Classical inpainting is intentionally not used on
  these regions.

## Health and metrics

- `GET /health` reports worker readiness, queue depth, processing count, and
  OSS availability.
- `GET /metrics` exposes queue depth, processing count, retries, average and P95
  duration, review outputs, terminal failures grouped by quality reason, and
  oldest pending age in Prometheus format.
- `GET /task/{task_id}` includes queue position and estimated wait time.

Alert when any of the following persists:

- no ready worker;
- OSS unavailable;
- oldest pending age above the product SLA;
- queue depth above 80% of capacity;
- terminal failure rate or P95 duration rises materially from the accepted
  regression baseline.

## Pre-deployment gate

Do not deploy merely because unit tests pass. A candidate must have:

1. all unit, concurrency, recovery, and worker fault tests passing;
2. the approved vertical reference image unchanged by visual review;
3. a source-traceable corpus report with every automated success visually
   reviewed, and expected unsafe watermark cases rejected rather than emitted;
4. a backup of the currently deployed service directory and `tasks.db`;
5. a candidate health check on an alternate local port;
6. an explicit deployment instruction from the owner.

## Rollback

Keep the prior service archive and database backup together. On rollback, stop
the candidate, restore the archived directory and database, then start the
previous PM2 definition and verify `/health`. Queue schema changes are additive;
the prior version ignores the added tables and columns, but restoring the paired
database backup is the safest rollback.

Third-party 1688 images are internal regression inputs and must not be included
in a release archive.
