"""GET /api/hiring-image: the "We are hiring" picture for a role typed in by hand (the AI agents page). Nothing is stored: the picture is
drawn from the title and city on every request (a small in-memory cache only saves redrawing the same one)."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.api.deps import require_core_app
from app.models.user import User
from app.services.hiring_image import file_name, hiring_image

router = APIRouter(prefix="/api/hiring-image", tags=["hiring-image"])


@router.get("")
async def draw_hiring_image(
    title: str = Query(..., min_length=1, max_length=200, description="The role, e.g. Senior Network & Security Engineer"),
    location: str = Query("", max_length=100, description="The city, e.g. Sharjah (a country after a comma is dropped)"),
    download: bool = Query(False, description="Send it as a file to save instead of showing it"),
    _: User = Depends(require_core_app),
) -> Response:
    if not title.strip():
        raise HTTPException(status_code=422, detail="Enter the job title.")
    try:
        data = await asyncio.to_thread(hiring_image, title.strip(), location.strip())
    except Exception:
        raise HTTPException(status_code=500, detail="The hiring image could not be created. Please try again.")
    disposition = "attachment" if download else "inline"
    return Response(content=data, media_type="image/jpeg",
                    headers={"Content-Disposition": f'{disposition}; filename="{file_name(title)}"', "Cache-Control": "private, max-age=300"})
