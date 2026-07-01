import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app import models, auth


SQLALCHEMY_DATABASE_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        sme = models.User(
            email="sme@harvest.com",
            password_hash=auth.get_password_hash("password123"),
            name="SME Alice",
            designation="Subject Matter Expert",
            role="sme",
            location="Both",
        )
        db.add(sme)
        db.commit()
        db.refresh(sme)

        auditor = models.User(
            email="auditor@harvest.com",
            password_hash=auth.get_password_hash("password123"),
            name="Auditor John",
            designation="Academic Auditor",
            role="auditor",
            location="Both",
        )
        db.add(auditor)

        other_auditor = models.User(
            email="auditor2@harvest.com",
            password_hash=auth.get_password_hash("password123"),
            name="Auditor Jane",
            designation="HOD",
            role="auditor",
            location="Both",
        )
        db.add(other_auditor)

        teacher = models.User(
            email="teacher@harvest.com",
            password_hash=auth.get_password_hash("password123"),
            name="Teacher Bob",
            designation="Primary Teacher",
            role="teacher",
            location="Kodathi",
            sme_id=sme.id,
        )
        db.add(teacher)

        unassigned_teacher = models.User(
            email="teacher2@harvest.com",
            password_hash=auth.get_password_hash("password123"),
            name="Teacher Carol",
            designation="Primary Teacher",
            role="teacher",
            location="Attibele",
            sme_id=None,
        )
        db.add(unassigned_teacher)
        db.commit()
    finally:
        db.close()

    yield

    Base.metadata.drop_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture
def client():
    return TestClient(app)


def auth_header(client, email, password="password123"):
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def sample_observation_payload(teacher_id):
    return {
        "school": "Kodathi",
        "subject": "Mathematics",
        "grade": "Grade 5",
        "section": "Section A",
        "teacher_id": teacher_id,
        "p11": 3,
        "p12": 3,
        "p21": 3,
        "p31": 3,
        "p32": 3,
        "p33": 3,
        "p34": 3,
        "infrastructure_issues": "",
        "other_issues": "",
        "objective_observations": "[10:00:00] Good lesson flow",
    }
