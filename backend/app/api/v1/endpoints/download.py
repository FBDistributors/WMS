"""
APK yuklab olish – web orqali mobile ilovani yuklash.
APK fayl backend/static/wms-app.apk da bo‘lishi kerak (yoki APK_PATH env orqali).
"""
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(tags=["download"])

# Backend project root (backend/)
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
_DEFAULT_APK = _BACKEND_ROOT / "static" / "wms-app.apk"


@router.get("/app", response_class=FileResponse)
def download_app():
    """Mobile ilova (APK) faylini yuklab olish."""
    apk_path_str = os.getenv("APK_PATH")
    path = Path(apk_path_str).resolve() if apk_path_str else _DEFAULT_APK
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="APK not found. Place app-debug.apk as static/wms-app.apk or set APK_PATH.",
        )
    return FileResponse(
        path,
        media_type="application/vnd.android.package-archive",
        filename="wms-mobile.apk",
    )
