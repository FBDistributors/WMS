"""Pytest fixtures for WMS backend tests."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.main import app
from app.db import get_db
from app.models.base import Base
from app.models.user import User
from app.models.user_session import UserSession
from app.models.product import Product
from app.models.location import Location
from app.auth.security import get_password_hash


# Use in-memory SQLite for tests
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session: Session):
    app.dependency_overrides[get_db] = lambda: iter([db_session])
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def test_user(db_session: Session) -> User:
    u = User(
        username="testuser",
        password_hash=get_password_hash("testpass123"),
        role="warehouse_admin",
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def test_product(db_session: Session) -> Product:
    p = Product(
        external_source="test",
        external_id="ext-001",
        name="Test Product",
        sku="SKU-TEST",
        is_active=True,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


@pytest.fixture
def test_location(db_session: Session) -> Location:
    loc = Location(code="LOC-01", barcode_value="LOC-01", name="Location 01", type="bin", is_active=True)
    db_session.add(loc)
    db_session.commit()
    db_session.refresh(loc)
    return loc
