-- Reference: PostgreSQL function mirroring "Finish Return" stock + status updates.
-- Application code path: `app.services.safe_cancel_return_service.finish_safe_cancel_return` (SQLAlchemy, single commit/rollback).

BEGIN;

CREATE OR REPLACE FUNCTION fn_safe_cancel_finish_return(p_session_id uuid, p_picker_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  d_id uuid;
  o_id uuid;
  sess_status text;
  sess_picker uuid;
  ln record;
BEGIN
  SELECT s.document_id, s.order_id, s.status, s.picker_user_id
    INTO d_id, o_id, sess_status, sess_picker
  FROM safe_cancel_return_sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF d_id IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF sess_picker IS DISTINCT FROM p_picker_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF sess_status IS DISTINCT FROM 'returns_pending' THEN
    RAISE EXCEPTION 'session_not_active';
  END IF;

  IF EXISTS (
    SELECT 1 FROM safe_cancel_return_lines l
    WHERE l.session_id = p_session_id
      AND (NOT l.location_confirmed OR NOT l.product_confirmed)
  ) THEN
    RAISE EXCEPTION 'scans_incomplete';
  END IF;

  IF (SELECT ows.status FROM order_wms_state ows WHERE ows.order_id = o_id) IS DISTINCT FROM 'cancelling_in_progress' THEN
    RAISE EXCEPTION 'order_state_mismatch';
  END IF;

  FOR ln IN
    SELECT l.product_id, l.lot_id, l.expected_location_id, l.document_line_id, l.qty_to_return, dl.picked_qty AS doc_picked
    FROM safe_cancel_return_lines l
    JOIN document_lines dl ON dl.id = l.document_line_id
    WHERE l.session_id = p_session_id
    FOR UPDATE OF dl
  LOOP
    IF ln.doc_picked::numeric < ln.qty_to_return THEN
      RAISE EXCEPTION 'picked_qty_mismatch';
    END IF;

    INSERT INTO stock_movements (id, product_id, lot_id, location_id, qty_change, movement_type, source_document_type, source_document_id, created_by_user_id)
    VALUES (gen_random_uuid(), ln.product_id, ln.lot_id, ln.expected_location_id, ln.qty_to_return, 'pick', 'document', d_id, p_picker_user_id);

    INSERT INTO stock_movements (id, product_id, lot_id, location_id, qty_change, movement_type, source_document_type, source_document_id, created_by_user_id)
    VALUES (gen_random_uuid(), ln.product_id, ln.lot_id, ln.expected_location_id, ln.qty_to_return, 'unallocate', 'document', d_id, p_picker_user_id);

    UPDATE document_lines SET picked_qty = 0 WHERE id = ln.document_line_id;
  END LOOP;

  UPDATE safe_cancel_return_sessions
    SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_session_id;

  UPDATE documents SET status = 'cancelled', updated_at = now() WHERE id = d_id;
  UPDATE order_wms_state SET status = 'cancelled', updated_at = now() WHERE order_id = o_id;
END;
$$;

COMMIT;
