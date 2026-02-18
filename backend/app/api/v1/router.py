from fastapi import APIRouter
from app.api.v1.endpoints import (
    audit,
    auth,
    brands,
    waves,
    dashboard,
    documents,
    download,
    integrations,
    inventory,
    locations,
    orders,
    picking,
    products,
    receiving,
    reports,
    scanner,
    users,
)

router = APIRouter()
router.include_router(audit.router, prefix="/audit", tags=["audit"])
router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(brands.router, prefix="/brands", tags=["brands"])
router.include_router(documents.router, prefix="/documents", tags=["documents"])
router.include_router(download.router, prefix="/download", tags=["download"])
router.include_router(orders.router, prefix="/orders", tags=["orders"])
router.include_router(locations.router, prefix="/locations", tags=["locations"])
router.include_router(inventory.router, prefix="/inventory", tags=["inventory"])
router.include_router(receiving.router, prefix="/receiving", tags=["receiving"])
router.include_router(reports.router, prefix="/reports", tags=["reports"])
router.include_router(picking.router, prefix="/picking", tags=["picking"])
router.include_router(products.router, prefix="/products", tags=["products"])
router.include_router(integrations.router, prefix="/integrations", tags=["integrations"])
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(scanner.router, prefix="/scanner", tags=["scanner"])
router.include_router(waves.router, prefix="/waves", tags=["waves"])