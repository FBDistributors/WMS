-- One-time backfill for orders that regressed to imported
-- while their picking documents are already in process.
--
-- Mapping:
-- - picked -> picked
-- - in_progress/partial/new/confirmed/draft/smartup_created -> picking (if any picked qty > 0), else allocated
--
-- Safe guard: only updates rows currently marked as imported.

WITH so_docs AS (
    SELECT
        d.order_id,
        d.status AS document_status,
        COALESCE(MAX(CASE WHEN dl.picked_qty > 0 THEN 1 ELSE 0 END), 0) AS picked_any
    FROM documents d
    LEFT JOIN document_lines dl ON dl.document_id = d.id
    WHERE d.doc_type = 'SO'
      AND d.order_id IS NOT NULL
      AND d.status IN ('new', 'confirmed', 'draft', 'smartup_created', 'partial', 'in_progress', 'picked')
    GROUP BY d.order_id, d.status
),
desired AS (
    SELECT
        order_id,
        CASE
            WHEN document_status = 'picked' THEN 'picked'
            WHEN picked_any = 1 THEN 'picking'
            ELSE 'allocated'
        END AS target_status
    FROM so_docs
)
UPDATE order_wms_state ows
SET status = d.target_status
FROM desired d
WHERE ows.order_id = d.order_id
  AND ows.status = 'imported';

