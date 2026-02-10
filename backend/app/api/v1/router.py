from fastapi import APIRouter
from app.api.v1.endpoints import (
    auth,
    brands,
    documents,
    integrations,
    inventory,
    locations,
    orders,
    picking,
    products,
    receiving,
    reports,
    users,
)

router = APIRouter()
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(brands.router, prefix="/brands", tags=["brands"])
router.include_router(documents.router, prefix="/documents", tags=["documents"])
router.include_router(orders.router, prefix="/orders", tags=["orders"])
router.include_router(locations.router, prefix="/locations", tags=["locations"])
router.include_router(inventory.router, prefix="/inventory", tags=["inventory"])
router.include_router(receiving.router, prefix="/receiving", tags=["receiving"])
router.include_router(reports.router, prefix="/reports", tags=["reports"])
router.include_router(picking.router, prefix="/picking", tags=["picking"])
router.include_router(products.router, prefix="/products", tags=["products"])
router.include_router(integrations.router, prefix="/integrations", tags=["integrations"])
router.include_router(users.router, prefix="/users", tags=["users"])