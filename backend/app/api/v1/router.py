from fastapi import APIRouter
from app.api.v1.endpoints import auth, documents, integrations, locations, orders, picking, products, users

router = APIRouter()
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(documents.router, prefix="/documents", tags=["documents"])
router.include_router(orders.router, prefix="/orders", tags=["orders"])
router.include_router(locations.router, prefix="/locations", tags=["locations"])
router.include_router(picking.router, prefix="/picking", tags=["picking"])
router.include_router(products.router, prefix="/products", tags=["products"])
router.include_router(integrations.router, prefix="/integrations", tags=["integrations"])
router.include_router(users.router, prefix="/users", tags=["users"])