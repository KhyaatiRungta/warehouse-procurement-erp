from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.config import CORS_ORIGINS, SEED_DEMO
from app.db import create_schema
from app.errors import ApiError
from app.routers import auth, inventory, master, procurement, receiving, reports


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_schema()
    if SEED_DEMO:
        from app.seed import seed_demo_data

        seed_demo_data()
    yield


app = FastAPI(title="Warehouse & Procurement ERP API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ApiError)
async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(IntegrityError)
async def integrity_error_handler(_request: Request, exc: IntegrityError) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={"detail": "This change conflicts with existing data. Refresh and try again."},
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


for router in (auth.router, master.router, inventory.router, procurement.router, receiving.router, reports.router):
    app.include_router(router)
