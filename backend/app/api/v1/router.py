from fastapi import APIRouter
from app.api.v1.endpoints import auth, documents, picking, products, users

router = APIRouter()
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(documents.router, prefix="/documents", tags=["documents"])
router.include_router(picking.router, prefix="/picking", tags=["picking"])
router.include_router(products.router, prefix="/products", tags=["products"])
router.include_router(users.router, prefix="/users", tags=["users"])