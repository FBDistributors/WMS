from fastapi import APIRouter
from app.api.v1.endpoints import documents, picking

router = APIRouter()
router.include_router(documents.router, prefix="/documents", tags=["documents"])
router.include_router(picking.router, prefix="/picking", tags=["picking"])